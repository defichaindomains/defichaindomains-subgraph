import {
  ABIChanged as ABIChangedEvent,
  AddrChanged as AddrChangedEvent,
  AddressChanged as AddressChangedEvent,
  AuthorisationChanged as AuthorisationChangedEvent,
  ContenthashChanged as ContenthashChangedEvent,
  DNSRecordChanged as DNSRecordChangedEvent,
  DNSRecordDeleted as DNSRecordDeletedEvent,
  DNSZoneCleared as DNSZoneClearedEvent,
  InterfaceChanged as InterfaceChangedEvent,
  NameChanged as NameChangedEvent,
  PubkeyChanged as PubkeyChangedEvent,
  TextChanged as TextChangedEvent,
} from "../generated/Resolver/Resolver";

import {
  Account,
  Domain,
  Resolver,
  AddrChanged,
  MulticoinAddrChanged,
  NameChanged,
  AbiChanged,
  PubkeyChanged,
  ContenthashChanged,
  InterfaceChanged,
  AuthorisationChanged,
  TextChanged,
} from "../generated/schema";

import { Bytes, BigInt, Address, ethereum } from "@graphprotocol/graph-ts";

import { log } from "@graphprotocol/graph-ts";

export function handleAddrChanged(event: AddrChangedEvent): void {
  let account = new Account(event.params.a.toHexString());
  account.save();

  let resolver = new Resolver(
    createResolverID(event.params.node, event.address)
  );
  resolver.domain = event.params.node.toHexString();
  resolver.address = event.address;
  resolver.addr = event.params.a.toHexString();
  resolver.save();

  let domain = Domain.load(event.params.node.toHexString());
  if (domain && domain.resolver == resolver.id) {
    domain.resolvedAddress = event.params.a.toHexString();
    domain.save();
  }

  let resolverEvent = new AddrChanged(createEventID(event));
  resolverEvent.resolver = resolver.id;
  resolverEvent.blockNumber = event.block.number.toI32();
  resolverEvent.transactionID = event.transaction.hash;
  resolverEvent.addr = event.params.a.toHexString();
  resolverEvent.save();
}

export function handleMulticoinAddrChanged(event: AddressChangedEvent): void {
  let resolver = getOrCreateResolver(event.params.node, event.address);

  // Handle cointypes that are outside the range we support
  if (!event.params.coinType.isI32()) {
    return;
  }

  let coinType = event.params.coinType.toI32();
  if (resolver.coinTypes == null) {
    resolver.coinTypes = [coinType];
    resolver.save();
  } else {
    let coinTypes = resolver.coinTypes!;
    if (!coinTypes.includes(coinType)) {
      coinTypes.push(coinType);
      resolver.coinTypes = coinTypes;
      resolver.save();
    }
  }

  let resolverEvent = new MulticoinAddrChanged(createEventID(event));
  resolverEvent.resolver = resolver.id;
  resolverEvent.blockNumber = event.block.number.toI32();
  resolverEvent.transactionID = event.transaction.hash;
  resolverEvent.coinType = coinType;
  resolverEvent.addr = event.params.newAddress;
  resolverEvent.save();
}

export function handleNameChanged(event: NameChangedEvent): void {
  if (event.params.name.indexOf("\u0000") != -1) return;

  let resolverEvent = new NameChanged(createEventID(event));
  resolverEvent.resolver = createResolverID(event.params.node, event.address);
  resolverEvent.blockNumber = event.block.number.toI32();
  resolverEvent.transactionID = event.transaction.hash;
  resolverEvent.name = event.params.name;
  resolverEvent.save();
}

export function handleABIChanged(event: ABIChangedEvent): void {
  let resolverEvent = new AbiChanged(createEventID(event));
  resolverEvent.resolver = createResolverID(event.params.node, event.address);
  resolverEvent.blockNumber = event.block.number.toI32();
  resolverEvent.transactionID = event.transaction.hash;
  resolverEvent.contentType = event.params.contentType;
  resolverEvent.save();
}

export function handlePubkeyChanged(event: PubkeyChangedEvent): void {
  let resolverEvent = new PubkeyChanged(createEventID(event));
  resolverEvent.resolver = createResolverID(event.params.node, event.address);
  resolverEvent.blockNumber = event.block.number.toI32();
  resolverEvent.transactionID = event.transaction.hash;
  resolverEvent.x = event.params.x;
  resolverEvent.y = event.params.y;
  resolverEvent.save();
}

export function handleTextChanged(event: TextChangedEvent): void {
  let resolver = getOrCreateResolver(event.params.node, event.address);
  let key = event.params.key;
  if (resolver.texts == null) {
    resolver.texts = [key];
    resolver.save();
  } else {
    let texts = resolver.texts!;
    if (!texts.includes(key)) {
      texts.push(key);
      resolver.texts = texts;
      resolver.save();
    }
  }

  let resolverEvent = new TextChanged(createEventID(event));
  resolverEvent.resolver = createResolverID(event.params.node, event.address);
  resolverEvent.blockNumber = event.block.number.toI32();
  resolverEvent.transactionID = event.transaction.hash;
  resolverEvent.key = event.params.key;
  resolverEvent.save();
}

export function handleDnsZoneCleared(event: DNSZoneClearedEvent): void {
  let resolver = getOrCreateResolver(event.params.node, event.address);
  resolver.rrs = null;
  resolver.save();
}

export function handleDnsRecordDeleted(event: DNSRecordDeletedEvent): void {
  let resolver = getOrCreateResolver(event.params.node, event.address);
  if (resolver.rrs == null) {
    return;
  }

  let encoded = encodeRRSetKey(event.params.name, event.params.resource);
  let old = resolver.rrs as Array<Bytes>;
  let newRRSets = new Array<Bytes>();

  for (let i = 0; i < old.length; i++) {
    if (encoded == old[i]) continue;

    newRRSets.push(old[i]);
  }

  resolver.rrs = newRRSets;
  resolver.save();
}

export function handleDnsRecordChanged(event: DNSRecordChangedEvent): void {
  let resolver = getOrCreateResolver(event.params.node, event.address);
  let encoded = encodeRRSetKey(event.params.name, event.params.resource);

  if (resolver.rrs == null) {
    resolver.rrs = [encoded];
    resolver.save();
    return;
  }

  let updated: Array<Bytes> = [encoded];
  let old = resolver.rrs as Array<Bytes>;

  for (let i = 0; i < old.length; i++) {
    let set = old[i];
    if (set.length > 4) {
      let k = decodeRRSetKey(set);
      if (event.params.name != k.name || event.params.resource != k.resource)
        updated.push(set);
    } else {
      // shouldn't happen
      return;
    }
  }

  resolver.rrs = updated;
  resolver.save();
}

// @ts-ignore
function encodeRRSetKey(name: Bytes, resource: i32): Bytes {
  let type = Bytes.fromI32(resource);
  let newRRset = new Bytes(name.length + 4);

  let i = 0;
  for (; i < name.length; i++) {
    newRRset[i] = name[i];
  }

  newRRset[i++] = type[0];
  newRRset[i++] = type[1];
  newRRset[i++] = type[2];
  newRRset[i] = type[3];

  return newRRset;
}

// Must always pass a Bytes of length > 4
function decodeRRSetKey(key: Bytes): RRSetKey {
  let name = Bytes.fromUint8Array(key.subarray(0, key.length - 4));
  let type = Bytes.fromUint8Array(key.subarray(key.length - 4));

  return { name: name, resource: type.toI32() };
}

class RRSetKey {
  name: Bytes;
  // @ts-ignore
  resource: i32;
}

export function handleContentHashChanged(event: ContenthashChangedEvent): void {
  let resolver = getOrCreateResolver(event.params.node, event.address);
  resolver.contentHash = event.params.hash;
  resolver.save();

  let resolverEvent = new ContenthashChanged(createEventID(event));
  resolverEvent.resolver = createResolverID(event.params.node, event.address);
  resolverEvent.blockNumber = event.block.number.toI32();
  resolverEvent.transactionID = event.transaction.hash;
  resolverEvent.hash = event.params.hash;
  resolverEvent.save();
}

export function handleInterfaceChanged(event: InterfaceChangedEvent): void {
  let resolverEvent = new InterfaceChanged(createEventID(event));
  resolverEvent.resolver = createResolverID(event.params.node, event.address);
  resolverEvent.blockNumber = event.block.number.toI32();
  resolverEvent.transactionID = event.transaction.hash;
  resolverEvent.interfaceID = event.params.interfaceID;
  resolverEvent.implementer = event.params.implementer;
  resolverEvent.save();
}

export function handleAuthorisationChanged(
  event: AuthorisationChangedEvent
): void {
  let resolverEvent = new AuthorisationChanged(createEventID(event));
  resolverEvent.blockNumber = event.block.number.toI32();
  resolverEvent.transactionID = event.transaction.hash;
  resolverEvent.resolver = createResolverID(event.params.node, event.address);
  resolverEvent.owner = event.params.owner;
  resolverEvent.target = event.params.target;
  resolverEvent.isAuthorized = event.params.isAuthorised;
  resolverEvent.save();
}

function getOrCreateResolver(node: Bytes, address: Address): Resolver {
  let id = createResolverID(node, address);
  let resolver = Resolver.load(id);
  if (resolver === null) {
    resolver = new Resolver(id);
    resolver.domain = node.toHexString();
    resolver.address = address;
  }
  return resolver as Resolver;
}

function createEventID(event: ethereum.Event): string {
  return event.block.number
    .toString()
    .concat("-")
    .concat(event.logIndex.toString());
}

function createResolverID(node: Bytes, resolver: Address): string {
  return resolver
    .toHexString()
    .concat("-")
    .concat(node.toHexString());
}
