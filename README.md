# js-codemod to transform $.ajax to fetch api.

This repository is used to transform jQuery.ajax to fetch API.

### Setup & Run

```sh
npm install -g jscodeshift

git clone https://github.com/croiden/jQuery.ajax-to-fetch-codemod.git

jscodeshift -t jQuery.ajax-to-fetch-codemod/transform/index.js <file | folder>
```

#### Note: 

- Don't forget to add the respective `parser` options while running the `jscodeshift` cmd. [`--parser=babel|babylon|flow|ts|tsx`]

- After running the codemod if you see any additional (`;`), Please remove them manually.



### Sample Transform 1


##### `Before:`
```js
$.ajax({
    url: url,
    type: 'PUT',
    success: success,
    error: error,
    data: { name: 'username' },
})
```

##### `After:`
```js
fetch(url, {
    method: 'PUT',
    body: REPLACE_WITH_QUERY_STRING_TRANSFORM_AT_BODY({ name: 'username' }),
    headers: {
        contentType: 'application/x-www-form-urlencoded',
    },
})
    .then(response => response.json())
    .then(success)
    .catch(error)
```


### Sample Transform 2


##### `Before:`
```js
$.ajax({
    url: '/api/v1/base/' + id + '/extra/check' + name,
    type: 'POST',
    data: JSON.stringify(data),
    dataType: 'json',
    headers: { 'X-Xsrf-Token': getXsrfToken() },
    contentType: 'application/json; charset=UTF-8',
})
    .done(function onSuccess(response) {
        // success logic
        console.log(response)
    })
    .fail(function onError(error) {
        // error logic
        console.log(error)
    })

```

##### `After:`
```js
fetch(`/api/v1/base/${id}/extra/check${name}`, {
    method: 'POST',
    body: JSON.stringify(data),
    headers: {
        'X-Xsrf-Token': getXsrfToken(),
        contentType: 'application/json; charset=UTF-8',
    },
})
    .then(response => response.json())
    .then(function onSuccess(response) {
        // success logic
        console.log(response)
    })
    .catch(function onError(error) {
        // error logic
        console.log(error)
    })

```


