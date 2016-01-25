'use strict';

let netns = require('..');
let util = require('../lib/util');

describe('network namespaces', () => {
    describe('setup', () => {
        before(() => util.exec('node dev/cleanup.js'));
        afterEach(() => util.exec('node dev/cleanup.js'));

        it('should create a network namespace with provided netns', () => netns(getNNSParams())
            .then(() => util.exec('ip netns show'))
            .then(list => list.should.containEql('test99'))
        );

        it('should create a network namespace with provided defaults', () => netns(getNNSDefaults())
            .then(() => util.exec('ip netns show'))
            .then(list => list.should.containEql('test0'))
        );

        describe('network namespace', () => {
            it('should access physical interface', () => netns(getNNSParams())
                .then(() => util.exec('ip route get 8.8.8.8'))
                .then(output => util.exec(`ip netns exec test99 ping -c 1 ${output.split('via ')[1].split(' ')[0]}`))
                .then(output => output.should.match(/1\s(packets |)received/))
            );

            it('should access the internet', () => netns(getNNSParams())
                .then(() => util.exec(`ip netns exec test99 ping -c 1 8.8.8.8`))
                .then(output => output.should.match(/1\s(packets |)received/))
            );
        });
    });

    describe('destroy', () => {
        afterEach(() => util.exec('node dev/cleanup.js'));

        it('should delete a network namespace', () => netns(getNNSParams())
            .then(nns => nns.destroy())
            .then(() => util.exec(`ip netns list`))
            .then(list => list.should.not.containEql('test99'))
        );

        it('should delete netns rules in default ns', () => netns(getNNSParams())
            .then(nns => nns.destroy())
            .then(() => util.exec(`ip route show`))
            .then(list => list.should.not.containEql('169.254'))
        );

        it('should delete netns iptables in default ns', () => netns(getNNSParams())
            .then(nns => nns.destroy())
            .then(() => util.exec(`iptables -t nat -vnL`))
            .then(list => list.should.not.containEql('169.254'))
        );
    });
});

function getNNSParams() {
    let n = 99;
    return {
        name: `test${n}`,
        vethDefault: `veth_ot${n}`,
        vethNNS: 'veth0',
        netmask: 30,
        network: '169.254.1.252',
        ipDefault: '169.254.1.253',
        ipNNS: '169.254.1.254',
        broadcast: '169.254.1.255'
    };
}

function getNNSDefaults() {
    return {
        prefix: 'test',
        ipStart: '169.254.123.0',
        ipMask: 24
    };
}

