'use strict';

var fs = require('fs');
var spawn = require('child_process').spawn;

module.exports = Object.freeze({
    promiseTimeout,
    throwAfterTimeout,
    exec,
    writeFile
});

function promiseTimeout(timeout) {
    return new Promise(resolve => setTimeout(resolve, timeout));
}

function throwAfterTimeout(err, timeout) {
    return new Promise((resolve, reject) => {
        setTimeout(() => reject(err), timeout);
    });
}

function exec(cmd, options) {
    return new Promise((resolve, reject) => {
        let bin = cmd.split(' ').shift();
        let params = cmd.split(' ').slice(1);
        let child = spawn(bin, params, options);
        let res = new Buffer(0);
        let err = new Buffer(0);

        child.stdout.on('data', buf => res = Buffer.concat([res, buf], res.length + buf.length));
        child.stderr.on('data', buf => err = Buffer.concat([err, buf], err.length + buf.length));
        child.on('close', code => {
            return setImmediate(() => {
                // setImmediate is required because there are often still
                // pending write requests in both stdout and stderr at this point
                console.log(cmd, err.toString(), res.toString());
                if (code) {
                    return reject(err.toString());
                }
                resolve(res.toString());
            });
        });
        child.on('error', reject);
    });
}

function writeFile(path, data, options) {
    return new Promise((resolve, reject) => {
        fs.writeFile(path, data, options, err => {
            if (err) {
                return reject(err);
            }
            resolve();
        });
    });
}

