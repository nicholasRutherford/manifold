// Filling in the bet-based fields on comments.

import * as admin from 'firebase-admin'
import { zip } from 'lodash'
import { initAdmin } from './script-init'
import {
  DocumentCorrespondence,
  findDiffs,
  describeDiff,
  applyDiff,
} from './denormalize'
import { log } from '../utils'
import { Transaction } from 'firebase-admin/firestore'

initAdmin()
const firestore = admin.firestore()

async function getBetComments(transaction: Transaction) {
  const allComments = await transaction.get(
    firestore.collectionGroup('comments')
  )
  const betComments = allComments.docs.filter((d) => d.get('betId'))
  log(`Found ${betComments.length} comments associated with bets.`)
  return betComments
}

async function denormalize() {
  let hasMore = true
  while (hasMore) {
    hasMore = await admin.firestore().runTransaction(async (trans) => {
      const betComments = await getBetComments(trans)
      const bets = await Promise.all(
        betComments.map((doc) =>
          trans.get(
            firestore
              .collection('contracts')
              .doc(doc.get('contractId'))
              .collection('bets')
              .doc(doc.get('betId'))
          )
        )
      )
      log(`Found ${bets.length} bets associated with comments.`)
      const mapping = zip(bets, betComments)
        .map(([bet, comment]): DocumentCorrespondence => {
          return [bet!, [comment!]] // eslint-disable-line
        })
        .filter(([bet, _]) => bet.exists) // dev DB has some invalid bet IDs

      const amountDiffs = findDiffs(mapping, 'amount', 'betAmount')
      const outcomeDiffs = findDiffs(mapping, 'outcome', 'betOutcome')
      log(`Found ${amountDiffs.length} comments with mismatched amounts.`)
      log(`Found ${outcomeDiffs.length} comments with mismatched outcomes.`)
      const diffs = amountDiffs.concat(outcomeDiffs)
      diffs.slice(0, 500).forEach((d) => {
        log(describeDiff(d))
        applyDiff(trans, d)
      })
      if (diffs.length > 500) {
        console.log(`Applying first 500 because of Firestore limit...`)
      }
      return diffs.length > 500
    })
  }
}

if (require.main === module) {
  denormalize().catch((e) => console.error(e))
}
