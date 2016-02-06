'use strict';

let namespace = require('./lib/namespace-utils');
let netutil = require('./lib/network-utils');

/**
 * Sets up a network namespace.
 *
 * Accepts one optional argument, a network configuration object or a defaults
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
 * This function may be called with at most one argument.
 * - when the argument is the defaults override, a network namespace config will
 *   be determined based on these settings.
 * - when the argument is the netns config, the netns will be created using the
 *   defaults
 *
 */
let netns = (params) => {
    let prefix = 'nns';
    let ipStart = '169.254.1.0';
    let ipMask = 30;

    const noImmediateRouting = params.noImmediateRouting || false;

    let defaults, nns;
    if ('undefined' !== typeof params) {
        if ('undefined' !== typeof params.name) {
            nns = params;
        } else {
            defaults = params;
        }
    }
    if (defaults) {
        if ('string' === typeof defaults.prefix) {
            prefix = defaults.prefix;
        }
        if ('string' === typeof defaults.ipStart) {
            ipStart = defaults.ipStart;
        }
        if ('number' === typeof defaults.ipMask) {
            ipMask = defaults.ipMask;
        }
    }

    let promise = Promise.resolve(nns);
    if ('undefined' === typeof nns) {
        promise = promise.then(() => namespace.getUnused({
            prefix,
            ipStart,
            ipMask
        }));
    }
    return promise.then(nns => {
        let name = nns.name;
        let vethDefault = nns.vethDefault;
        let vethNNS = nns.vethNNS;
        let ipDefault = nns.ipDefault;
        let ipNNS = nns.ipNNS;
        let netmask = nns.netmask;
        let network = nns.network;
        // Clean up network namespace in case it already exists. Start fresh.
        return namespace.del(name)
            .then(() => namespace.create(name))
            .then(() => namespace.addVethPair({
                name,
                vethDefault,
                vethNNS,
                ipDefault,
                ipNNS,
                netmask
            }))
            .then(() => namespace.enableForwarding({
                name,
                vethNNS,
                ipDefault,
            }))
            .then(() => netutil.enableForwarding({
                link: vethDefault,
                source: ipNNS
            }))
            .then(() => namespace.setupRouting({
                name,
                vethNNS,
                ipDefault,
            }))
            .then(() => noImmediateRouting ? undefined : namespace.setupImmediateRouting({
                name,
                vethNNS,
            }))
            .then(() => netutil.addRoute({
                network,
                netmask,
                link: vethDefault
            }))
            .then(() => namespace.setupDNS({
                name,
                servers: ['8.8.8.8']
            }))
            .then(() => Object.freeze({
                destroy: () => Promise.all([
                    namespace.del(name),
                    netutil.delLink(vethDefault),
                    netutil.disableForwarding(ipNNS),
                    netutil.delRoute({
                        network,
                        netmask,
                        link: vethDefault
                    })
                ]),
                config: Object.freeze(nns),
                exec: namespace.getExec(nns.name),
                execNoWait: namespace.getExecNoWait(nns.name)
            }));
    });
};

module.exports = Object.freeze(netns);

