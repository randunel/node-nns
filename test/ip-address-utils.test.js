'use strict';

let ip = require('../lib/ip-address-utils');
let should = require('should'); // jshint ignore: line

describe('ip utils', () => {
    describe('intFromIp', () => {
        it('0', () => ip.intFromIP('0.0.0.0').should.equal(0));
        it('1', () => ip.intFromIP('0.0.0.1').should.equal(1));
        it('max positive', () => ip.intFromIP('127.255.255.255').should.equal(2147483647));
        it('max negative', () => ip.intFromIP('128.0.0.0').should.equal(-2147483648));
        it('-1', () => ip.intFromIP('255.255.255.255').should.equal(-1));
        it('10', () => ip.intFromIP('10.0.0.1').should.equal(167772161));
        it('192', () => ip.intFromIP('192.168.0.1').should.equal(-1062731775));
    });

    describe('ipFromInt', () => {
        it('0', () => ip.ipFromInt(0).should.equal('0.0.0.0'));
        it('1', () => ip.ipFromInt(1).should.equal('0.0.0.1'));
        it('max positive', () => ip.ipFromInt(2147483647).should.equal('127.255.255.255'));
        it('max negative', () => ip.ipFromInt(-2147483648).should.equal('128.0.0.0'));
        it('-1', () => ip.ipFromInt(-1).should.equal('255.255.255.255'));
        it('10', () => ip.ipFromInt(167772161).should.equal('10.0.0.1'));
        it('192', () => ip.ipFromInt(-1062731775).should.equal('192.168.0.1'));
    });

    describe('intFromMask', () => {
        it ('32', () => ip.intFromMask(32).should.equal(-1));
        it ('31', () => ip.intFromMask(31).should.equal(-2));
        it ('30', () => ip.intFromMask(30).should.equal(-4));
        it ('29', () => ip.intFromMask(29).should.equal(-8));
        it ('28', () => ip.intFromMask(28).should.equal(-16));
        it ('24', () => ip.intFromMask(24).should.equal(-256));
        it ('16', () => ip.intFromMask(16).should.equal(-65536));
        it ('8', () => ip.intFromMask(8).should.equal(-16777216));
        it ('4', () => ip.intFromMask(4).should.equal(-268435456));
        it ('3', () => ip.intFromMask(3).should.equal(-536870912));
        it ('2', () => ip.intFromMask(2).should.equal(-1073741824));
        it ('1', () => ip.intFromMask(1).should.equal(-2147483648));
    });
});

