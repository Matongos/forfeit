# Forfeit — stake MON on your own discipline

**Lock a stake, check in every window, or your friend takes the pot.**

## Problem

Habit apps can't stop you from quitting — ignoring a notification costs nothing.

## Solution

Forfeit makes skipping cost real money. You stake MON against your own habit.
Check in on time, every time, and you withdraw it all back. Miss one window and
the contract hands your stake to your friend — no support line, no refunds, no
way out. Only a smart contract can make a commitment you literally cannot cancel.

## Live app

**https://forfeit-two.vercel.app** (MetaMask on Monad testnet)

## Contract

`HabitStake.sol` on **Monad testnet** (chain 10143):

**Address:** `0xaf4099cf3b4f47d3a7385b071f0e74a7681b7757` — [view on explorer](https://testnet.monadexplorer.com/address/0xaf4099cf3b4f47d3a7385b071f0e74a7681b7757)

- `create(beneficiary, window, minGap, required, refereeMode, habit)` — lock a stake (payable)
- `checkIn(id)` — log a check-in; must be after `minGap`, before `window` expires
- `slash(id)` — anyone can call once a window is blown; stake goes to the beneficiary
- `withdraw(id)` — owner reclaims the full stake after completing all check-ins

State changes happen before transfers (checks-effects-interactions). Finishing
your check-ins protects you from slashing immediately, even before withdrawing.

## Run locally

```sh
npm install
npm run dev        # frontend at localhost:5173 (MetaMask on Monad testnet)
npm run deploy     # compile + deploy contract (needs .wallet.json with a funded key)
```

## Demo video

`TBD_VIDEO_LINK`
