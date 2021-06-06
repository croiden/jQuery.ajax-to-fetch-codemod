export default function transformer(file, api) {
    const j = api.jscodeshift
    let SOURCE = file.source

    const DEFAULT_FORMAT = { quote: 'single', trailingComma: true, tabWidth: 4 }
    const CALL_ME_AT_URL = 'REPLACE_WITH_QUERY_STRING_TRANSFORM_AT_URL'
    const CALL_ME_AT_BODY = 'REPLACE_WITH_QUERY_STRING_TRANSFORM_AT_BODY'

    /** Function is used to convert the binary expression into template string */
    const convertToTemplateString = p => {
        const extractNodes = node => {
            if (node.type === 'BinaryExpression' && node.operator === '+') {
                return [...extractNodes(node.left), ...extractNodes(node.right)]
            }

            return [node]
        }

        const tempNodes = extractNodes(p.value)

        const isStringNode = node => node.type === 'Literal' && typeof node.value === 'string'

        if (!tempNodes.some(isStringNode)) {
            return p.node
        }

        const buildTL = (nodes, quasis = [], expressions = [], temp = '') => {
            if (nodes.length === 0) {
                const newQuasis = [...quasis, j.templateElement({ cooked: temp, raw: temp }, true)]

                return [newQuasis, expressions]
            }

            const [a, ...rest] = nodes

            if (a.type === 'Literal') {
                return buildTL(rest, quasis, expressions, temp + a.value)
            }

            const nextTemplateElement = j.templateElement({ cooked: temp, raw: temp }, false)

            const newQuasis = quasis.concat(nextTemplateElement)
            const newExpressions = expressions.concat(a)

            return buildTL(rest, newQuasis, newExpressions, '')
        }

        return j.templateLiteral(...buildTL(tempNodes))
    }

    /** Function is used to check of the callback is on jQuery ajax */
    const isCallFromJQueryAjax = node => {
        if (node.callee && node.callee.object && node.callee.object.name) {
            return (
                (node.callee.object.name === '$' && node.callee.property.name === 'ajax') ||
                (node.callee.object.name === '$' && node.callee.property.name === 'get') ||
                (node.callee.object.name === '$' && node.callee.property.name === 'getJSON') ||
                (node.callee.object.name === 'jQuery' && node.callee.property.name === 'ajax') ||
                (node.callee.object.name === 'jQuery' && node.callee.property.name === 'get') ||
                (node.callee.object.name === 'jQuery' && node.callee.property.name === 'getJSON')
            )
        }
        return node.callee && node.callee.object ? isCallFromJQueryAjax(node.callee.object) : false
    }

    /** Function is used to get the url for fetch */
    const getFetchURL = url => {
        let result
        if (url.value.type === 'BinaryExpression') {
            result = convertToTemplateString(url)
        } else {
            result = url.value
        }
        return result ? result : url.value
    }

    /** Function is used to get the content type based on the data */
    const getContentType = (contentType, data, isFormData) =>
        contentType
            ? contentType
            : data && isFormData
            ? j.property('init', j.identifier('contentType'), j.literal('application/x-www-form-urlencoded'))
            : null

    /** Function is used to get the headers with contentType */
    const getHeaders = (headers, contentType, data, isFormData) => {
        const cType = getContentType(contentType, data, isFormData)
        if (cType) {
            if (headers) {
                headers.value.properties.push(cType)
            } else {
                return j.property('init', j.identifier('headers'), j.objectExpression([cType]))
            }
        }
        return headers
    }

    /** Function is used to wrap the data with dummy function (can be used for queryString transformation) */
    const getPolishedData = data => {
        if (data.value.type === 'ObjectExpression' || data.value.type === 'Identifier') {
            return {
                data: j.property('init', data.key, j.callExpression(j.identifier(CALL_ME_AT_BODY), [data.value])),
                isFormData: true,
            }
        }

        return { data, isFormData: false }
    }

    /** Function is used to append the data to the url */
    const addDataToURL = (url, data) => {
        const addQuestionMark = j.binaryExpression('+', url.value, j.literal('?'))
        const callDataWithWrapper = j.callExpression(j.identifier(CALL_ME_AT_URL), [data.value])
        return j.property('init', j.literal('url'), j.binaryExpression('+', addQuestionMark, callDataWithWrapper))
    }

    /** Function is used to create the fetch call with params */
    const getFetchCallWithParams = (url, properties) => {
        /** Create fetch parameters */
        const fetchParams = properties.length > 0 ? [url, j.objectExpression(properties)] : [url]

        /** Create fetch call expression */
        return j.callExpression(j.identifier('fetch'), fetchParams)
    }

    const appendCallback = (parent, callbackName, callbackFunction) => {
        const MemberExpression = j.memberExpression(parent, j.identifier(callbackName))

        return j.callExpression(MemberExpression, [callbackFunction])
    }

    /** Function is used to construct the .(response)=> response.json() arrow function */
    const getConvertToJSONCallback = () => {
        const responseCallExp = j.callExpression(j.memberExpression(j.identifier('response'), j.identifier('json')), [])
        return j.arrowFunctionExpression([j.identifier('response')], responseCallExp, false)
    }

    /** Function is used to rename callbacks like .done and .fail */
    const renameCallbacks = (find, replace) =>
        j(SOURCE)
            .find(j.CallExpression, {
                callee: {
                    type: 'MemberExpression',
                    object: {
                        type: 'CallExpression',
                    },
                    property: {
                        type: 'Identifier',
                        name: find,
                    },
                },
            })
            .replaceWith(nodePath => {
                const { node } = nodePath
                if (isCallFromJQueryAjax(node)) {
                    node.callee.property.name = replace
                }
                return node
            })
            .toSource(DEFAULT_FORMAT)

    SOURCE = renameCallbacks('done', 'then')
    SOURCE = renameCallbacks('fail', 'catch')

    const transformFile = (S, objectName, propertyName) =>
        j(S)
            .find(j.CallExpression, {
                callee: {
                    type: 'MemberExpression',
                    object: {
                        type: 'Identifier',
                        name: objectName,
                    },
                    property: {
                        type: 'Identifier',
                        name: propertyName,
                    },
                },
            })
            .replaceWith(nodePath => {
                let isGET = true
                const properties = []
                let url, data, contentType, headers, successCallback, errorCallback

                /** Loop all the ajax properties */
                nodePath.value.arguments[0].properties.forEach(p => {
                    const keyName = p.key.name
                    if (keyName === 'url') {
                        url = p
                    } else if (keyName === 'type' || keyName === 'method') {
                        p.key.name = 'method'
                        if (p.value.value !== 'GET') {
                            isGET = false
                            properties.push(p)
                        }
                    } else if (keyName === 'data') {
                        p.key.name = 'body'
                        data = p
                    } else if (keyName === 'contentType') {
                        contentType = p
                    } else if (keyName === 'headers') {
                        headers = p
                    } else if (keyName === 'dataType') {
                        // ignore property
                    } else if (keyName === 'cache') {
                        if (p.value) {
                            p.value = j.literal('force-cache')
                            properties.push(p)
                        }
                    } else if (keyName === 'traditional') {
                        // ignore property
                    } else if (keyName === 'success') {
                        successCallback = p.value
                    } else if (keyName === 'error' || keyName === 'failure') {
                        errorCallback = p.value
                    } else {
                        properties.push(p)
                    }
                })

                let isFormData = false
                if (isGET) {
                    if (data) {
                        /** Append data to the url */
                        url = addDataToURL(url, data)
                    }
                } else if (data) {
                    const dataObj = getPolishedData(data)
                    data = dataObj.data
                    isFormData = dataObj.isFormData
                    properties.push(data)
                }

                url = getFetchURL(url)

                /** Update headers property with content type */
                const newHeadersProperty = getHeaders(headers, contentType, data, isFormData)
                if (newHeadersProperty) {
                    properties.push(newHeadersProperty)
                }

                const fetchCall = getFetchCallWithParams(url, properties)

                const convertToJSONCallback = getConvertToJSONCallback()

                const fetchCallWithResponseJSON = appendCallback(fetchCall, 'then', convertToJSONCallback)

                if (successCallback && errorCallback) {
                    const fetchCallWithSuccess = appendCallback(fetchCallWithResponseJSON, 'then', successCallback)

                    return j.expressionStatement(appendCallback(fetchCallWithSuccess, 'catch', errorCallback))
                } else if (successCallback) {
                    return j.expressionStatement(appendCallback(fetchCallWithResponseJSON, 'then', successCallback))
                } else if (errorCallback) {
                    return j.expressionStatement(appendCallback(fetchCallWithResponseJSON, 'catch', errorCallback))
                } else {
                    return j.expressionStatement(fetchCallWithResponseJSON)
                }
            })
            .toSource(DEFAULT_FORMAT)

    SOURCE = transformFile(SOURCE, '$', 'ajax')
    // SOURCE = transformFile(SOURCE, '$', 'get')
    // SOURCE = transformFile(SOURCE, '$', 'getJSON')
    // SOURCE = transformFile(SOURCE, 'jQuery', 'ajax')
    // SOURCE = transformFile(SOURCE, 'jQuery', 'get')
    // SOURCE = transformFile(SOURCE, 'jQuery', 'getJSON')

    return SOURCE
}
