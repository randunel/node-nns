## nns

Creates network namespaces.

## Usage

#### Create a network namespace with specific config.
```js
let nns = require('nns'); // 1. require
nns({ // 2. invoke
    name: 'asd12',
    vethDefault: 'veth_asd12',
    vethNNS: 'veth0',
    netmask: 30,
    network: '169.254.1.252',
    ipDefault: '169.254.1.253',
    ipNNS: '169.254.1.254',
    broadcast: '169.254.1.255'
})
    .then(() => {
        // 3. ???
    })
    .then(() => {
        console.log('Profit!'); // 4.
    })
```

#### Create a network namespace using custom defaults
```js
let nns = require('nns'); // 1. require
nns({ // 2. invoke
    prefix: 'custom',
    ipStart: '169.254.123.0',
    ipMask: 30
})
    .then(() => {
        // 3. ???
    })
    .then(() => {
        console.log('Profit!'); // 4.
    })
```

#### Simply create a network namespace, don't care about settings
```js
let nns = require('nns'); // 1. require
nns() // 2. invoke
    .then(() => {
    // 3. ???
    })
    .then(() => {
        console.log('Profit!'); // 4.
    })
```

## Tests

`npm test`

