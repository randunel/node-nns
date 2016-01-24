'use strict';

let ip = require('./ip-address-utils');
let util = require('./util');

module.exports = Object.freeze({
    getUnused,
    enableForwarding,
    disableForwarding,
    addRoute,
    delRoute,
    getGateway,
    delLink
});

function getUnused(params) {
    let ipMask = params.ipMask;
    let ipStart = params.ipStart;
    return util.exec('ip addr show')
        .then(list => Promise.all(list
            .split('\n')
            .filter(line => /\s*inet\s/.test(line))
            .map(line => line.split('inet ')[1].split(' ')[0])
        ))
        .then(ips => {
            let unavailableNetworks = ips
                .filter(address => /^169\./.test(address))
                .map(address => address.split('/')[0])
                .map(address => ip.intFromIP(address) & ip.intFromMask(ipMask));
            return findNextUnused(0);

            function findNextUnused(counter) {
                let network = ip.intFromIP(ipStart) + (Math.abs(ip.intFromMask(ipMask)) * counter);
                if (unavailableNetworks.find(uNetwork => uNetwork === network)) {
                    return findNextUnused(counter + 1);
                }
                return ip.ipFromInt(network);
            }
        });
}

function enableForwarding(params) {
    let link = params.link;
    let source = params.source;
    return util.exec(`sysctl net.ipv4.ip_forward=1`)
        // Use masquerate to change source ip address from nns to default
        //
        // Alternatively, SNAT (faster) can be used, but that means the
        // public ip address of the interface needs to be retrieved, and it
        // would not survive ip address changes
        // iptables -t nat -D POSTROUTING -s 169.254.254.2 -o PUBLIC_INTERFACE -j SNAT --to-source IP_ADDRESS_OF_PUBLIC_INTERFACE
        .then(() => util.exec(`iptables -t nat -A POSTROUTING -s ${source} -j MASQUERADE`))
        // Remove filter to allow packet replies from nns to default
        .then(() => util.exec(`sysctl net.ipv4.conf.${link}.rp_filter=2`))
        // Loosen up reverse path filtering on all interfaces
        // TODO(me): I don't know why this affects some linux installations. Individual
        // rules per-interface should work (but they don't always do)
        .then(() => util.exec(`sysctl net.ipv4.conf.all.rp_filter=2`))
        .then(() => util.exec(`sysctl net.ipv4.conf.${link}.proxy_arp=1`));
}

function addRoute(params) {
    let network = params.network;
    let netmask = params.netmask;
    let link = params.link;
    return util.exec(`ip route add ${network}/${netmask} dev ${link}`)
        .catch(err => {
            if ('string' === typeof err && err.includes('File exists')) {
                // Route already exists, possibly from other runs. Delete and try again
                return util.exec(`ip route del ${network}/${netmask}`)
                    .then(() => util.exec(`ip route add ${network}/${netmask} dev ${link}`));
            }
            return Promise.reject(err);
        });
}

function getGateway(destination) {
    return util.exec(`ip route get ${destination}`)
        .then(route => {
            if (!route || route.indexOf('via') === -1) {
                let err = new Error('No route found');
                throw err;
            }
            let immediateGateway = route.split('via ')[1].split(' ')[0];
            if (!immediateGateway) {
                let err = new Error('Could not extract gateway');
                throw err;
            }
            immediateGateway = immediateGateway.trim();
            return util.exec(`ip route show match ${immediateGateway}`)
                .then(route => {
                    let srcLine = route.split('\n')
                        .find(line => line.indexOf(' src ') > -1);
                    if (!srcLine) {
                        let err = new Error('Could not extract src address.');
                        throw err;
                    }
                    let immediateNetwork = srcLine.trim().split(' ')[0];
                    return immediateNetwork;
                });
        });
}

function delRoute(params) {
    let network = params.network;
    let netmask = params.netmask;
    let link = params.link;
    return util.exec(`ip route del ${network}/${netmask} dev ${link}`)
        .catch(err => {
            if (err.includes('Cannot find device') || err.includes('No such process')) {
                return;
            }
            return Promise.reject(err);
        });
}

function disableForwarding(source) {
    return util.exec(`iptables -t nat -D POSTROUTING -s ${source} -j MASQUERADE`);
}

function delLink(link) {
    return util.exec(`ip link del ${link}`);
}

