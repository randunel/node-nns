'use strict';

module.exports = Object.freeze({
    ipFromInt,
    intFromIP,
    intFromMask
});

function ipFromInt(n) {
    return `${(n >> 24) & 0xff}.${(n >> 16) & 0xff}.${(n >> 8) & 0xff}.${n & 0xff}`;
}

function intFromIP(ip) {
    return ip
        .split('.')
        .map((chunk, ix) => Number(chunk) << ((3 - ix) * 8))
        .reduce((prev, curr) => prev + curr, 0);
}

function intFromMask(mask) {
    return -1 << (32 - mask);
}

