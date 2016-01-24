'use strict';

let util = require('./util.js');

let _prefix = 'nns';
let _ipStart = '169.254.1.0';
let _ipMask = 30;

/**
 * Sets up a network namespace.
 *
 * Accepts at most two arguments, a network configuration object and a defaults
 * object override.
 *
 * The configuration object must contain:
 *
 * @param {String} name Network namespace name `/var/run/netns/${name}`.
 * @param {String} vethDefault Virtual ethernet pair link in the default
 *        namespace `/proc/sys/net/ipv4/conf/${vethDefault}`
 * @param {String} vethNNS Virtual ethernet pair link in the network namespace
 *        `/proc/sys/net/ipv4/conf/${vethNNS}`
 * @param {String} ipDefault IP address to be assigned to the default veth link
 *        (must be in the same network as ${ipNNS})
 * @param {String} ipNNS IP address to be assigned to the netns veth link
 *        (must be in the same network as ${ipDefault})
 * @param {int} netmask Netmask used by the veth pair, CIDR notation
 * @param {String} network Network address for the veth pair (ip & netmask)
 *
 * The defaults override may contain any of:
 *
 * @param {String} prefix Network namespace name prefix. Each netns will be
 *        created using the prefix, followed by an incrementing number ${name}N.
 *        Defaults to `'nns'`.
 * @param {String} ipStart If no netns params are specified on setup, then
 *        available networks will be autodetected starting from this one. These
 *        ip addresses will be used by the virtual ethernet pairs for inter-netns
 *        communication and forwarding.
 *        Defaults to `'169.254.1.0'`.
 * @param {int} ipMask The netmask the veth pairs will use when assigned their
 *        ip addresses.
 *        Defaults to `30`.
 *
 * This function may be called with a single param.
 * - when param is the defaults override, a network namespace config will be
 *   determined based on these settings.
 * - when param is the netns config, the netns will be created using the defaults
 *
 */
let netns = (param1, param2) => {
    let defaults, nns;
    if ('undefined' !== typeof param2) {
        defaults = param2;
        nns = param1;
    } else if ('undefined' !== typeof param1) {
        if ('undefined' !== typeof param1.name) {
            nns = param1;
        } else {
            defaults = param1;
        }
    }
    if (defaults) {
        if ('string' === typeof defaults.prefix) {
            _prefix = defaults.prefix;
        }
        if ('string' === typeof defaults.ipStart) {
            _ipStart = defaults.ipStart;
        }
        if ('number' === typeof defaults.ipMask) {
            _ipMask = defaults.ipMask;
        }
    }

    let promise = Promise.resolve(nns);
    if ('undefined' === typeof nns) {
        promise.then(netns._getUnusedNNS);
    }
    return promise.then(nns => {
        let name = nns.name;
        let vethDefault = nns.vethDefault;
        let vethNNS = nns.vethNNS;
        let ipDefault = nns.ipDefault;
        let ipNNS = nns.ipNNS;
        let netmask = nns.netmask;
        let network = nns.network;
        const NNSEXEC = `ip netns exec ${name}`;
        // Clean up network namespace in case it already exists. Start fresh.
        return util.exec(`ip netns del ${name}`)
            .catch(() => {})
            // Create network namespace
            .then(() => util.exec(`ip netns add ${name}`))
            // Set up loopback interface. This step is optional, but some
            // programs may exhibit unexpected behaviour should one not exist
            .then(() => util.exec(`${NNSEXEC} ip link set dev lo up`))
            // Set up a veth pair
            .then(() => util.exec(`ip link add ${vethDefault} type veth peer name ${vethNNS}`))
            // Move a veth endpoint to the network namespace
            .then(() => util.exec(`ip link set ${vethNNS} netns ${name}`))
            // Assign static ip address to veth outside namespace
            .then(() => util.exec(`ip addr add ${ipDefault}/${netmask} dev ${vethDefault}`))
            .then(() => util.exec(`ip link set dev ${vethDefault} up`))
            // Assign static ip address to veth inside network namespace
            .then(() => util.exec(`${NNSEXEC} ip addr add ${ipNNS}/${netmask} dev ${vethNNS}`))
            .then(() => util.exec(`${NNSEXEC} ip link set dev ${vethNNS} up`))
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
                            return util.exec(`${NNSEXEC} cat /sys/class/net/${vethNNS}/operstate`).then(data => {
                                if (data.includes('up')) {
                                    return resolve();
                                }
                                if (data.includes('lowerlayerdown')) {
                                    return util.exec(`ip link set dev ${vethDefault} up`).then(checkAgain);
                                }
                                return util.promiseTimeout(100).then(checkAgain);
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
                                        return util.exec(`${NNSEXEC} ip link set dev ${vethNNS} up`).then(checkAgain);
                                    }
                                    return util.promiseTimeout(100).then(checkAgain);
                                });
                            function checkAgain() {
                                return check(--count);
                            }
                        }
                    })
                ])
            ]))
            // Enable routing inside network namespace for packets from the outside
            .then(() => util.exec(`${NNSEXEC} iptables -t nat -A POSTROUTING -s ${ipDefault} -j MASQUERADE`))
            // Allow packets forwarding in netns
            .then(() => util.exec(`${NNSEXEC} sysctl net.ipv4.ip_forward=1`))
            // Allow packets forwarding in default
            .then(() => util.exec(`sysctl net.ipv4.ip_forward=1`))
            .then(() => util.exec(`${NNSEXEC} sysctl net.ipv4.conf.${vethNNS}.forwarding=1`))
            .then(() => util.exec(`${NNSEXEC} sysctl net.ipv4.conf.${vethNNS}.proxy_arp=1`))
            // Use masquerate to change source ip address from nns to default
            //
            // Alternatively, SNAT (faster) can be used, but that means the
            // public ip address of the interface needs to be retrieved, and it
            // would not survive ip address changes
            // iptables -t nat -D POSTROUTING -s 169.254.254.2 -o PUBLIC_INTERFACE -j SNAT --to-source IP_ADDRESS_OF_PUBLIC_INTERFACE
            .then(() => util.exec(`iptables -t nat -A POSTROUTING -s ${ipNNS} -j MASQUERADE`))
            // Remove filter to allow packet replies from nns to default
            .then(() => util.exec(`sysctl net.ipv4.conf.${vethDefault}.rp_filter=2`))
            // Loosen up reverse path filtering on all interfaces
            // TODO(me): I don't know why this affects some linux installations. Individual
            // rules per-interface should work (but they don't always do)
            .then(() => util.exec(`sysctl net.ipv4.conf.all.rp_filter=2`))
            // Path from default to namespace address
            .then(() => util.exec(`ip route add ${network}/${netmask} dev ${vethDefault}`))
            .catch(err => {
                if ('string' === typeof err && err.includes('File exists')) {
                    // Route already exists, possibly from other runs. Delete and try again
                    return util.exec(`ip route del ${network}/${netmask}`)
                        .then(() => util.exec(`ip route add ${network}/${netmask} dev ${vethDefault}`));
                }
                return Promise.reject(err);
            })
            // Path from namespace to default
            .then(() => util.exec(`${NNSEXEC} ip route add ${ipDefault}/32 dev ${vethNNS}`))
            .then(() => util.exec(`sysctl net.ipv4.conf.${vethDefault}.proxy_arp=1`))
            // DNS resolver is namespace specific
            .then(() => util.exec(`mkdir -p /etc/netns/${name}`))
            .then(() => util.writeFile(`/etc/netns/${name}/resolv.conf`, 'nameserver 8.8.8.8\n'))
            // Get default routes to the outside world.
            //
            // In order to allow programs running inside the network namespace
            // to access the real gateway and the local network, the route must
            // be set explicitly inside the nns
            .then(() => util.exec(`ip route get 128.0.0.0/1`))
            .then(route => {
                if (!route || route.indexOf('via') === -1) {
                    return;
                }
                let immediateGateway = route.split('via ')[1].split(' ')[0];
                if (!immediateGateway) {
                    console.error(`Could not extract gateway from ${route}.`);
                    return;
                }
                immediateGateway = immediateGateway.trim();
                return util.exec(`ip route show match ${immediateGateway}`)
                    .then(route => {
                        let srcLine = route.split('\n')
                            .find(line => line.indexOf(' src ') > -1);
                        if (!srcLine) {
                            console.error(`Could not extract src from ${route}.`);
                            return;
                        }
                        let immediateNetwork = srcLine.trim().split(' ')[0];
                        return util.exec(`${NNSEXEC} ip route add ${immediateNetwork} dev ${vethNNS}`);
                    });
            });
    });
};

netns._getUnusedNNS = () => Promise.all([
    netns._getUnusedNNSName(), // 'ot123'
    netns._getUnusedNetwork() // '169.254.123.0'
])
    .then(nnsData => {
        let intNetwork = netns._intFromIP(nnsData[1]);
        return {
            name: nnsData[0],
            vethDefault: `veth_${nnsData[0]}`,
            vethNNS: 'veth0',
            netmask: _ipMask,
            network: nnsData[1],
            ipDefault: netns._ipFromInt(intNetwork + 1),
            ipNNS: netns._ipFromInt(intNetwork + 2),
            broadcast: netns._ipFromInt(intNetwork | (~netns._intFromMask(_ipMask)))
        };
    });

netns.destroy = nns => Promise.all([
    util.exec(`ip netns del ${nns.name}`),
    util.exec(`ip link del ${nns.vethDefault}`),
    util.exec(`iptables -t nat -D POSTROUTING -s ${nns.ipNNS} -j MASQUERADE`),
    util.exec(`ip route del ${nns.network}/${nns.netmask} dev ${nns.vethDefault}`)
        .catch(err => {
            if (err.includes('Cannot find device') || err.includes('No such process')) {
                return;
            }
            return Promise.reject(err);
        }),
]);

netns._getUnusedNNSName = () => util.exec('ip netns list')
    .then(list => {
        let names = list
            .split('\n')
            .map(line => line.split(' ')[0]);
        return findNextUnused(0);

        function findNextUnused(counter) {
            let nnsName = `${_prefix}${counter}`;
            if (names.find(name => name === nnsName)) {
                return findNextUnused(counter + 1);
            }
            return nnsName;
        }
    });

netns._getUnusedNetwork = () => util.exec('ip link show')
    .then(list => Promise.all(list
        .split('\n')
        .filter(line => /\d+:\s/.test(line))
        .map(line => line
            .split(':')[1]
            .trim())
            .map(device => {
                return util.exec(`ip addr show ${device.split('@')[0]}`)
                    .then(list => {
                        let inetLine = list
                            .split('\n')
                            .find(line => /inet\s/.test(line));
                        if (!inetLine) {
                            return;
                        }
                        return inetLine.split('inet ')[1].split(' ')[0];
                    });
            })
    ))
    .then(ips => {
        let unavailableNetworks = ips
            .filter(ip => /^169\./.test(ip))
            .map(ip => ip.split('/')[0])
            .map(ip => netns._intFromIP(ip) & netns._intFromMask(_ipMask));
        return findNextUnused(0);

        function findNextUnused(counter) {
            let network = netns._intFromIP(_ipStart) + (Math.abs(netns._intFromMask(_ipMask)) * counter);
            if (unavailableNetworks.find(uNetwork => uNetwork === network)) {
                return findNextUnused(counter + 1);
            }
            return netns._ipFromInt(network);
        }
    });

netns._ipFromInt = n => `${(n >> 24) & 0xff}.${(n >> 16) & 0xff}.${(n >> 8) & 0xff}.${n & 0xff}`;

netns._intFromIP = ip => ip
    .split('.')
    .map((chunk, ix) => Number(chunk) << ((3 - ix) * 8))
    .reduce((prev, curr) => prev + curr, 0);

netns._intFromMask = mask => -1 << (32 - mask);

module.exports = Object.freeze(netns);

