'use strict';

let util = require('../lib/util');

util.exec('ip netns list')
    .then(list => Promise.all(list
        .split('\n')
        .filter(line => !!line)
        .map(el => {console.log('el ' + el); return el;})
        .map(line => line.split(' ')[0])
        .map(netns => util.exec(`ip netns delete ${netns}`))
    ))
    .then(() => util.exec('ip link show'))
    .then(list => Promise.all(list
        .split('\n')
        .filter(line => /\d+:\s/.test(line))
        .map(line => line.split(':')[1].trim())
        .filter(device => /veth_ot/.test(device))
        .map(el => {console.log('el ' + el); return el;})
        .map(device => util.exec(`ip link delete ${device.split('@')[0]}`))
    ))
    .then(() => util.exec('ip route show'))
    .then(list => Promise.all(list
        .split('\n')
        .filter(line => /169\./.test(line))
        .map(el => {console.log('el ' + el); return el;})
        .map(line => util.exec(`ip route delete ${line}`))
    ))
    .then(() => util.exec('iptables -t nat -vnL --line-numbers'))
    .then(list => {
        let promise = Promise.resolve();
        list
            .split('\n')
            .filter(line => /\s+169\./.test(line))
            .reverse()
            .map(el => {console.log('el ' + el); return el;})
            .forEach(line => {
                promise = promise.then(() => util.exec(`iptables -t nat -D POSTROUTING ${line.split(' ')[0]}`));
            });
        return promise;
    }).catch(err => {
        console.error(err);
    });

