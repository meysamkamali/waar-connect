import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeSource, hostOf, isOwnSource, localNets, networkOf } from './network.ts';

const nets = [
  { iface: 'ens34', address: '10.0.0.41', netmask: '255.255.255.0' },
  { iface: 'ens37', address: '10.100.1.105', netmask: '255.255.255.0' },
];

test('hostOf takes the host out of an NDI url_address', () => {
  assert.equal(hostOf('10.1.1.107:5961'), '10.1.1.107');
  assert.equal(hostOf('[fe80::1]:5961'), 'fe80::1');
  assert.equal(hostOf('fe80::1'), 'fe80::1');
  assert.equal(hostOf('eng07.local'), 'eng07.local');
  assert.equal(hostOf(null), null);
  assert.equal(hostOf(''), null);
});

test('networkOf names the interface on the sender subnet, null through a router', () => {
  assert.equal(networkOf('10.100.1.112:5961', nets), 'ens37');
  assert.equal(networkOf('10.0.0.7:5961', nets), 'ens34');
  assert.equal(networkOf('10.1.1.107:5961', nets), null);
  assert.equal(networkOf('eng07.local:5961', nets), null);
  assert.equal(networkOf(null, nets), null);
  assert.equal(networkOf('10.100.1.112:5961', []), null);
});

test('isOwnSource matches the NDI machine name of this host', () => {
  assert.equal(isOwnSource('CONNECT (Guest 1)', 'connect'), true);
  assert.equal(isOwnSource('CONNECT (Guest 1)', 'connect.waar.lan'), true);
  assert.equal(isOwnSource('ENG07 (WAAR PGM on ENG07)', 'connect'), false);
  assert.equal(isOwnSource('CONNECTOR (x)', 'connect'), false);
  assert.equal(isOwnSource('X (y)', ''), false);
});

test('localNets lists IPv4 addresses without loopback', () => {
  const found = localNets({
    lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }],
    ens37: [
      { address: '10.100.1.105', netmask: '255.255.255.0', family: 'IPv4', mac: '00:0c:29:28:68:a5', internal: false, cidr: '10.100.1.105/24' },
      { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '00:0c:29:28:68:a5', internal: false, cidr: 'fe80::1/64', scopeid: 2 },
    ],
  });
  assert.deepEqual(found, [{ iface: 'ens37', address: '10.100.1.105', netmask: '255.255.255.0' }]);
});

test('describeSource adds network and own to a seen source', () => {
  assert.deepEqual(describeSource({ name: 'NDI (OUT 1)', url: '10.100.1.112:5961' }, nets, 'connect'), {
    name: 'NDI (OUT 1)',
    url: '10.100.1.112:5961',
    network: 'ens37',
    own: false,
  });
  assert.deepEqual(describeSource({ name: 'CONNECT (Guest 2)', url: '10.0.0.41:5962' }, nets, 'connect'), {
    name: 'CONNECT (Guest 2)',
    url: '10.0.0.41:5962',
    network: 'ens34',
    own: true,
  });
});
