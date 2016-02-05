'use strict';

let util = require('./util');
let ip = require('./ip-address-utils');
let netutil = require('./network-utils');

const NNSEXEC = 'ip netns exec';

module.exports = Object.freeze({
    getUnused,
    del,
    create,
    addVethPair,
    enableForwarding,
    setupRouting,
    setupDNS,
    getExec,
    getExecNoWait
});

function getUnused(params) {
    return Promise.all([
        getUnusedName(params.prefix), // 'nns123'
        netutil.getUnused({ // '169.254.123.0'
            ipStart: params.ipStart,
            ipMask: params.ipMask
        })
    ])
        .then(nnsData => {
            let intNetwork = ip.intFromIP(nnsData[1]);
            return {
                name: nnsData[0],
                vethDefault: `veth_${nnsData[0]}`,
                vethNNS: 'veth0',
                netmask: params.ipMask,
                network: nnsData[1],
                ipDefault: ip.ipFromInt(intNetwork + 1),
                ipNNS: ip.ipFromInt(intNetwork + 2),
                broadcast: ip.ipFromInt(intNetwork | (~ip.intFromMask(params.ipMask)))
            };
        });
}

function getUnusedName(prefix) {
    return util.exec('ip netns list')
        .then(list => {
            let names = list
                .split('\n')
                .map(line => line.split(' ')[0]);
            return findNextUnused(0);

            function findNextUnused(counter) {
                let nnsName = `${prefix}${counter}`;
                if (names.find(name => name === nnsName)) {
                    return findNextUnused(counter + 1);
                }
                return nnsName;
            }
        });
}

function create(name) {
    return util.exec(`ip netns add ${name}`)
        // Set up loopback interface. This step is optional, but some
        // programs may exhibit unexpected behaviour should one not exist
        .then(() => util.exec(`${NNSEXEC} ${name} ip link set dev lo up`));
}

function addVethPair(params) {
    let name = params.name;
    let vethDefault = params.vethDefault;
    let vethNNS = params.vethNNS;
    let ipDefault = params.ipDefault;
    let ipNNS = params.ipNNS;
    let netmask = params.netmask;
    return util.exec(`ip link add ${vethDefault} type veth peer name ${vethNNS}`)
        // Move a veth endpoint to the network namespace
        .then(() => util.exec(`ip link set ${vethNNS} netns ${name}`))
        // Assign static ip address to veth outside namespace
        .then(() => util.exec(`ip addr add ${ipDefault}/${netmask} dev ${vethDefault}`))
        // Assign static ip address to veth inside network namespace
        .then(() => util.exec(`${NNSEXEC} ${name} ip addr add ${ipNNS}/${netmask} dev ${vethNNS}`))
        .then(() => bringVethPairUp({
            name,
            vethDefault,
            vethNNS
        }));
}

function bringVethPairUp(params) {
    let name = params.name;
    let vethDefault = params.vethDefault;
    let vethNNS = params.vethNNS;
    return util.exec(`ip link set dev ${vethDefault} up`)
        .then(() => util.exec(`${NNSEXEC} ${name} ip link set dev ${vethNNS} up`))
        /**
         * Cross check veth pair operstate.
         *
         * Examples for veth1 and veth2 pair:
         *
         * veth1 link, veth1 operstate, veth2 link, veth2 operstate
         * down        down             down        down
         * down        down             up          lowerlayerdown
         * up          up               up          up
         * up          lowerlayerdown   down        down
         *
         */
        .then(() => Promise.race([
            util.throwAfterTimeout(new Error('Interface did not come up'), 5000),
            Promise.all([
                new Promise((resolve, reject) => {
                    return check(10);
                    function check(count) {
                        if (!count) {
                            let err = new Error('NNS interface up checks exceeded');
                            return reject(err);
                        }
                        return util.exec(`${NNSEXEC} ${name} cat /sys/class/net/${vethNNS}/operstate`)
                            .then(data => {
                                if (data.includes('up')) {
                                    return resolve();
                                }
                                if (data.includes('lowerlayerdown')) {
                                    return util.exec(`ip link set dev ${vethDefault} up`)
                                        .then(checkAgain);
                                }
                                return util.promiseTimeout(100)
                                    .then(checkAgain);
                            });
                        function checkAgain() {
                            return check(--count);
                        }
                    }
                }),
                new Promise((resolve, reject) => {
                    return check(10);
                    function check(count) {
                        if (!count) {
                            let err = new Error('Interface up checks exceeded');
                            return reject(err);
                        }
                        return util.exec(`cat /sys/class/net/${vethDefault}/operstate`)
                            .then(data => {
                                if (data.includes('up')) {
                                    return resolve();
                                }
                                if (data.includes('lowerlayerdown')) {
                                    return util.exec(`${NNSEXEC} ${name} ip link set dev ${vethNNS} up`)
                                        .then(checkAgain);
                                }
                                return util.promiseTimeout(100)
                                    .then(checkAgain);
                            });
                        function checkAgain() {
                            return check(--count);
                        }
                    }
                })
            ])
        ]));
}

function enableForwarding(params) {
    let name = params.name;
    let vethNNS = params.vethNNS;
    let ipDefault = params.ipDefault;
    // Enable routing inside network namespace for packets from the outside
    return util.exec(`${NNSEXEC} ${name} iptables -t nat -A POSTROUTING -s ${ipDefault} -j MASQUERADE`)
        // Enable touring inside network namespace for outgoing packets
        // This is not required for network namespaces, but it is required for openvpn forwarding
        .then(() => util.exec(`${NNSEXEC} ${name} iptables -t nat -A POSTROUTING -o ${vethNNS} -j MASQUERADE`))
        // Allow packets forwarding in netns
        .then(() => util.exec(`${NNSEXEC} ${name} sysctl net.ipv4.ip_forward=1`))
        .then(() => util.exec(`${NNSEXEC} ${name} sysctl net.ipv4.conf.${vethNNS}.forwarding=1`))
        .then(() => util.exec(`${NNSEXEC} ${name} sysctl net.ipv4.conf.${vethNNS}.proxy_arp=1`));
}

function setupRouting(params) {
    let name = params.name;
    let vethNNS = params.vethNNS;
    let ipDefault = params.ipDefault;
    return util.exec(`${NNSEXEC} ${name} ip route add ${ipDefault}/32 dev ${vethNNS}`)
        // Get default routes to the outside world.
        //
        // In order to allow programs running inside the network namespace
        // to access the real gateway and the local network, the route must
        // be set explicitly inside the nns
        .then(() => netutil.getGateway('128.0.0.0/1'))
        .then(gateway => util.exec(`${NNSEXEC} ${name} ip route add ${gateway} dev ${vethNNS}`))
        .then(() => util.exec(`${NNSEXEC} ${name} ip route add default via ${ipDefault}`));
}

function setupDNS(params) {
    let name = params.name;
    let servers = params.servers;
    return util.exec(`mkdir -p /etc/netns/${name}`)
        .then(() => util.writeFile(`/etc/netns/${name}/resolv.conf`, servers
            .map(server => `nameserver ${server}\n`)));
}

function del(name) {
    return util.exec(`ip netns del ${name}`)
        .catch(err => {
            if (err.includes('No such file or directory')) {
                return;
            }
            throw err;
        });
}

function getExec(name) {
    return (cmd, options) => util.exec(`ip netns exec ${name} ${cmd}`, options);
}

function getExecNoWait(name) {
    return (cmd, options) => util.execNoWait(`ip netns exec ${name} ${cmd}`, options);
}

