'use strict';

let namespace = require('../lib/namespace-utils');
let netns = require('..');
let util = require('../lib/util');

const defaults = {
    prefix: 'test',
    ipStart: '169.254.123.0',
    ipMask: '30'
};

describe('namespace utils', () => {
    describe('getUnused', () => {
        describe('in clean state', () => {
            before(() => util.exec('node dev/cleanup.js'));

            it('should start counter with 0', () => namespace
                .getUnused(defaults)
                .then(nns => nns.name.should.equal('test0'))
            );

            it('should start network pool with .0', () => namespace
                .getUnused(defaults)
                .then(nns => nns.network.should.equal('169.254.123.0'))
            );
        });

        describe('when one network exists', () => {
            before(() => netns(defaults));
            after(() => util.exec('node dev/cleanup.js'));

            it('should continue counter with 1', () => namespace
                .getUnused(defaults)
                .then(nns => nns.name.should.equal('test1'))
            );

            it('should continue network pool with .1.4', () => namespace
                .getUnused(defaults)
                .then(nns => nns.network.should.equal('169.254.123.4'))
            );
        });

        describe('when 2 networks exists', () => {
            before(() => netns(defaults)
                .then(() => netns(defaults))
            );
            after(() => util.exec('node dev/cleanup.js'));

            it('should continue counter with 2', () => namespace
                .getUnused(defaults)
                .then(nns => nns.name.should.equal('test2'))
            );

            it('should continue network pool with .1.8', () => namespace
                .getUnused(defaults)
                .then(nns => nns.network.should.equal('169.254.123.8'))
            );
        });
    });
});


