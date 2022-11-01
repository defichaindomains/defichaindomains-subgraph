// Import types and APIs from graph-ts
import {
  BigInt,
  ByteArray,
  Bytes,
  crypto,
  ens,
  log
} from '@graphprotocol/graph-ts'

import { byteArrayFromHex, concat, createEventID, uint256ToByteArray } from './utils'

// Import event types from the registry contract ABI
import {
  NameRegistered as NameRegisteredEvent,
  Transfer as TransferEvent
} from './types/BaseRegistrarImplementation/BaseRegistrarImplementation'


import {
  NameRegistered as ControllerNameRegisteredEvent,
} from './types/EthRegistrarController/EthRegistrarController'

// Import entity types generated from the GraphQL schema
import { Account, Domain, NameRegistered, NameTransferred, Registration } from './types/schema'

var rootNode:ByteArray = byteArrayFromHex("93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae")

export function handleNameRegistered(event: NameRegisteredEvent): void {
  let account = new Account(event.params.owner.toHex())
  account.save()

  let label = uint256ToByteArray(event.params.id)
  let registration = new Registration(label.toHex())
  let domain = Domain.load(crypto.keccak256(concat(rootNode, label)).toHex())!

  registration.domain = domain.id
  registration.registrationDate = event.block.timestamp
  registration.registrant = account.id

  let labelName = ens.nameByHash(label.toHexString())
  if (labelName != null) {
    domain.labelName = labelName
    registration.labelName = labelName
  }
  domain.save()
  registration.save()

  let registrationEvent = new NameRegistered(createEventID(event))
  registrationEvent.registration = registration.id
  registrationEvent.blockNumber = event.block.number.toI32()
  registrationEvent.transactionID = event.transaction.hash
  registrationEvent.registrant = account.id
  registrationEvent.save()
}


export function handleNameRegisteredByController(event: ControllerNameRegisteredEvent): void {
  setNamePreimage(event.params.name, event.params.label, event.params.cost)
}



function setNamePreimage(name: string, label: Bytes, cost: BigInt): void {
  const labelHash = crypto.keccak256(ByteArray.fromUTF8(name));
  if(!labelHash.equals(label)) {
    log.warning(
      "Expected '{}' to hash to {}, but got {} instead. Skipping.",
      [name, labelHash.toHex(), label.toHex()]
    );
    return;
  }

  if(name.indexOf(".") !== -1) {
    log.warning("Invalid label '{}'. Skipping.", [name]);
    return;
  }

  let domain = Domain.load(crypto.keccak256(concat(rootNode, label)).toHex())!
  if(domain.labelName !== name) {
    domain.labelName = name
    domain.name = name + '.eth'
    domain.save()
  }

  let registration = Registration.load(label.toHex());
  if(registration == null) return
  registration.labelName = name
  registration.cost = cost
  registration.save()
}



export function handleNameTransferred(event: TransferEvent): void {
  let account = new Account(event.params.to.toHex())
  account.save()

  let label = uint256ToByteArray(event.params.tokenId)
  let registration = Registration.load(label.toHex())
  if(registration == null) return;

  registration.registrant = account.id
  registration.save()

  let transferEvent = new NameTransferred(createEventID(event))
  transferEvent.registration = label.toHex()
  transferEvent.blockNumber = event.block.number.toI32()
  transferEvent.transactionID = event.transaction.hash
  transferEvent.newOwner = account.id
  transferEvent.save()
}
