import { useCallback, useEffect, useRef, useState } from 'react';
import { formatEther, isAddress, parseEther } from 'viem';
import {
  ABI, CHAIN, CONTRACT, EXPLORER, publicClient, readCommitment, nextId,
  short, walletClient, type Commitment,
} from './lib/contract';

const GAS_RESERVE = parseEther('0.1'); // keep enough MON aside to pay for all the txs

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  return now;
}

function fmtClock(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

function fmtDur(s: number) {
  if (s % 3600 === 0) return `${s / 3600}H`;
  if (s >= 60 && s % 60 === 0) return `${s / 60}M`;
  return `${s}S`;
}

type Phase = 'ready' | 'gap' | 'overdue' | 'won' | 'completed' | 'slashed';

function phaseOf(c: Commitment, now: number): Phase {
  if (c.status === 1) return 'completed';
  if (c.status === 2) return 'slashed';
  if (c.done >= c.required) return 'won';
  const last = Number(c.lastCheckIn) * 1000;
  if (now > last + c.window * 1000) return 'overdue';
  if (now < last + c.minGap * 1000) return 'gap';
  return 'ready';
}

const STATUS_LABELS: Record<Phase, string> = {
  ready: 'ACTIVE', gap: 'ACTIVE', overdue: 'OVERDUE',
  won: 'WON — UNCLAIMED', completed: 'COMPLETED', slashed: 'SLASHED',
};

export default function App() {
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [id, setId] = useState<bigint | null>(null);
  const [c, setC] = useState<Commitment | null>(null);
  const [wantNew, setWantNew] = useState(false);
  const [toast, setToast] = useState('');
  const [toastError, setToastError] = useState(false);
  const [busy, setBusy] = useState(false);
  const now = useNow();
  // stake is zeroed onchain after payout; remember it for the final slip copy
  const lastStake = useRef(0n);
  if (c && c.stake > 0n) lastStake.current = c.stake;

  const connect = useCallback(async () => {
    const eth = (window as any).ethereum;
    if (!eth) { setToast('No wallet found — install MetaMask'); setToastError(true); return; }
    try {
      const [a] = await eth.request({ method: 'eth_requestAccounts' });
      const hex = '0x' + CHAIN.id.toString(16);
      try {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
      } catch (e: any) {
        if (e?.code === 4902) {
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: hex, chainName: CHAIN.name, nativeCurrency: CHAIN.nativeCurrency,
              rpcUrls: [CHAIN.rpcUrls.default.http[0]], blockExplorerUrls: [EXPLORER],
            }],
          });
        } else throw e;
      }
      setAccount(a);
    } catch (e: any) {
      setToast(e?.shortMessage ?? e?.message ?? String(e)); setToastError(true);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!account) return;
    const n = await nextId();
    if (id !== null && id < n) { setC(await readCommitment(id)); return; }
    for (let i = n - 1n; i >= 0n; i--) {
      const cm = await readCommitment(i);
      if (cm.owner.toLowerCase() === account.toLowerCase()) { setId(i); setC(cm); return; }
      if (i === 0n) break;
    }
    setC(null);
  }, [account, id]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const send = useCallback(async (fn: string, args: any[], value?: bigint) => {
    setBusy(true); setToastError(false); setToast('Confirm in wallet…');
    try {
      const wc = walletClient();
      const [a] = await wc.requestAddresses();
      const hash = await wc.writeContract({
        address: CONTRACT, abi: ABI, functionName: fn, args, value, account: a,
      });
      setToast(`${fn}() — pending on Monad…`);
      await publicClient.waitForTransactionReceipt({ hash });
      await refresh();
      setToast('');
      if (fn === 'create') setWantNew(false);
    } catch (e: any) {
      setToast(e?.shortMessage ?? e?.message ?? String(e)); setToastError(true);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const showLanding = !account;
  const showCreate = account && (!c || wantNew);
  const showSlip = account && c && !wantNew;

  return (
    <div className="shell">
      <header>
        <div className="wordmark-sm">FORFEIT</div>
        {account && (
          <div className="wallet-pill"><span className="dot" />YOU · {short(account)}</div>
        )}
      </header>
      <main>
        {showLanding && (
          <div className="landing">
            <div className="wordmark-xl">FORFEIT</div>
            <div className="landing-tag">Lock a stake, check in every window,<br />or your friend takes the pot.</div>
            <div className="steps">
              <div><span>1</span>Stake MON</div>
              <div><span>2</span>Check in on time</div>
              <div><span>3</span>Win it back — or forfeit</div>
            </div>
            <button className="btn-connect" onClick={connect}>CONNECT WALLET</button>
            <div className="landing-fine">Monad testnet · every button is a real transaction</div>
          </div>
        )}

        {showCreate && (
          <CreateForm
            account={account!} busy={busy}
            onCreate={(args, value) => send('create', args, value)}
          />
        )}

        {showSlip && (
          <SlipCard
            id={id!} c={c!} now={now} busy={busy}
            onCheckIn={() => send('checkIn', [id])}
            onSlash={() => send('slash', [id])}
            onWithdraw={() => send('withdraw', [id])}
            onNew={() => setWantNew(true)}
            lastStake={lastStake.current}
          />
        )}
      </main>

      {toast && (
        <div className={`toast ${toastError ? 'error' : ''}`}><span className="dot" />{toast}</div>
      )}
      <footer>
        HABITSTAKE.SOL · MONAD TESTNET ·{' '}
        <a href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer">
          {short(CONTRACT).toUpperCase()}
        </a>
      </footer>
    </div>
  );
}

function CreateForm({ account, busy, onCreate }: {
  account: `0x${string}`; busy: boolean;
  onCreate: (args: any[], value: bigint) => void;
}) {
  const [habit, setHabit] = useState('');
  const [stake, setStake] = useState('1');
  const [beneficiary, setBeneficiary] = useState('');
  const [winVal, setWinVal] = useState('48');
  const [winUnit, setWinUnit] = useState('h');
  const [gapVal, setGapVal] = useState('16');
  const [gapUnit, setGapUnit] = useState('h');
  const [required, setRequired] = useState('7');
  const [preset, setPreset] = useState<'daily' | 'demo' | 'custom'>('daily');
  const [balance, setBalance] = useState<bigint | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    publicClient.getBalance({ address: account }).then(setBalance).catch(() => {});
  }, [account]);

  const toSec = (v: string, u: string) =>
    Math.round((parseFloat(v) || 0) * (u === 'h' ? 3600 : u === 'm' ? 60 : 1));

  const applyPreset = (p: 'daily' | 'demo') => {
    setPreset(p);
    if (p === 'daily') { setWinVal('48'); setWinUnit('h'); setGapVal('16'); setGapUnit('h'); setRequired('7'); }
    else { setWinVal('90'); setWinUnit('s'); setGapVal('20'); setGapUnit('s'); setRequired('2'); }
  };
  const custom = (fn: (v: string) => void) => (v: string) => { fn(v); setPreset('custom'); };

  const submit = () => {
    const win = toSec(winVal, winUnit), gap = toSec(gapVal, gapUnit);
    const req = parseInt(required) || 0;
    let stakeWei = 0n;
    try { stakeWei = parseEther(stake || '0'); } catch { /* not a number */ }
    if (!habit.trim()) return setError('Name the habit — the slip needs terms.');
    if (stakeWei <= 0n) return setError('Stake something. Zero costs nothing.');
    if (!beneficiary.trim()) return setError('Who gets paid when you fail?');
    if (!isAddress(beneficiary)) return setError('Not a wallet address — copy the 0x… address from your friend’s MetaMask.');
    if (beneficiary.toLowerCase() === account.toLowerCase()) return setError('Beneficiary can’t be you — pick a friend.');
    if (balance !== null && stakeWei + GAS_RESERVE > balance)
      return setError(`Stake less — you have ${Number(formatEther(balance)).toFixed(2)} MON and need ~0.1 for gas.`);
    if (req <= 0 || win <= 0 || gap >= win) return setError('Bad timing: min gap must be shorter than the window.');
    setError('');
    onCreate([beneficiary.trim(), win, gap, req, false, habit.trim()], stakeWei);
  };

  return (
    <div className="slip-wrap">
      <div className="perf-top" />
      <div className="slip-body">
        <div className="slip-head">
          <div className="slip-brand">FORFEIT</div>
          <div className="slip-meta">NEW SLIP · WRITE YOUR TERMS</div>
        </div>
        <div className="chips">
          <button className={`chip ${preset === 'daily' ? 'on' : ''}`} onClick={() => applyPreset('daily')}>DAILY HABIT · 48H/16H/7</button>
          <button className={`chip ${preset === 'demo' ? 'on' : ''}`} onClick={() => applyPreset('demo')}>DEMO PRESET · 90S/20S/2</button>
        </div>
        <label className="field">THE HABIT
          <input value={habit} onChange={(e) => setHabit(e.target.value)} placeholder="gym before 9am" />
        </label>
        <div className="grid-2">
          <label className="field">STAKE (MON){balance !== null && <span className="balance-hint"> · you have {Number(formatEther(balance)).toFixed(2)}</span>}
            <input value={stake} onChange={(e) => setStake(e.target.value)} />
          </label>
          <label className="field">PAYS ON FAILURE (BENEFICIARY)
            <input value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} placeholder="0x…" />
          </label>
        </div>
        <div className="grid-3">
          <label className="field">WINDOW
            <div className="with-unit">
              <input value={winVal} onChange={(e) => custom(setWinVal)(e.target.value)} />
              <select value={winUnit} onChange={(e) => custom(setWinUnit)(e.target.value)}>
                <option value="h">h</option><option value="m">m</option><option value="s">s</option>
              </select>
            </div>
          </label>
          <label className="field">MIN GAP
            <div className="with-unit">
              <input value={gapVal} onChange={(e) => custom(setGapVal)(e.target.value)} />
              <select value={gapUnit} onChange={(e) => custom(setGapUnit)(e.target.value)}>
                <option value="h">h</option><option value="m">m</option><option value="s">s</option>
              </select>
            </div>
          </label>
          <label className="field">CHECK-INS
            <input value={required} onChange={(e) => custom(setRequired)(e.target.value)} />
          </label>
        </div>
        <div className="warning">Miss one window and the contract pays your stake to the beneficiary. No refunds. No support line. No way out.</div>
        {error && <div className="form-error">{error}</div>}
        <button className="btn-slip btn-place" disabled={busy} onClick={submit}>
          {busy ? 'CONFIRM IN WALLET…' : `PLACE YOUR STAKE — ${stake || '?'} MON`}
        </button>
      </div>
      <div className="perf-bottom" />
    </div>
  );
}

function SlipCard({ id, c, now, busy, onCheckIn, onSlash, onWithdraw, onNew, lastStake }: {
  id: bigint; c: Commitment; now: number; busy: boolean;
  onCheckIn: () => void; onSlash: () => void; onWithdraw: () => void; onNew: () => void;
  lastStake: bigint;
}) {
  const phase = phaseOf(c, now);
  const overdue = phase === 'overdue';
  const final = phase === 'completed' || phase === 'slashed';
  const last = Number(c.lastCheckIn) * 1000;
  const gapLeft = last + c.minGap * 1000 - now;
  const deadlineLeft = last + c.window * 1000 - now;
  const stakeWei = c.stake > 0n ? c.stake : lastStake;
  const stakeStr = `${formatEther(stakeWei)} MON`;

  const vars = {
    '--slip-bg': overdue ? '#C8102E' : '#FAFAF7',
    '--slip-ink': overdue ? '#FAFAF7' : '#14181C',
    '--slip-rule': overdue ? 'rgba(250,250,247,.4)' : 'rgba(20,24,28,.25)',
  } as React.CSSProperties;

  return (
    <div className="slip-wrap" style={vars}>
      <div className="perf-top" />
      <div className="slip-body">
        <div className="slip-head">
          <div className="slip-brand">FORFEIT</div>
          <div className="slip-meta">SLIP NO. {id.toString().padStart(6, '0')} · {STATUS_LABELS[phase]}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="wager-label">THE WAGER</div>
          <div className="wager">{c.habit}</div>
        </div>
        <div className="terms">STAKE: {stakeStr} · WINDOW: {fmtDur(c.window)} · PAYS: {short(c.beneficiary)}</div>

        {(phase === 'ready' || phase === 'gap' || overdue) && (
          <div className="countdown-block">
            <div className="countdown-label">{overdue ? 'WINDOW BLOWN' : 'TIME LEFT TO CHECK IN'}</div>
            <div className={`countdown ${overdue ? 'blown' : ''}`}>{overdue ? '00:00' : fmtClock(deadlineLeft)}</div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="ticks-head"><span>CHECK-INS</span><span>{c.done} / {c.required}</span></div>
          <div className="ticks-row">
            {Array.from({ length: c.required }, (_, i) => (
              <div key={i} className={`tick ${i < c.done ? 'done' : ''} ${i === c.done - 1 ? 'latest' : ''}`}>
                {i < c.done && <span style={{ color: overdue ? '#C8102E' : '#FAFAF7' }}>✓</span>}
              </div>
            ))}
          </div>
        </div>

        {(phase === 'ready' || phase === 'gap') && (
          <button className="btn-slip btn-checkin" disabled={busy || phase === 'gap'} onClick={onCheckIn}>
            {busy ? 'CONFIRM IN WALLET…' : phase === 'gap' ? `NEXT CHECK-IN OPENS IN ${fmtClock(gapLeft)}` : 'CHECK IN'}
          </button>
        )}
        {overdue && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="claim-copy">Window blown. The stake is forfeit — anyone can trigger the payout to {short(c.beneficiary)}.</div>
            <button className="btn-slip btn-claim" disabled={busy} onClick={onSlash}>
              {busy ? 'CONFIRM IN WALLET…' : `CLAIM THEIR STAKE — ${stakeStr}`}
            </button>
          </div>
        )}
        {phase === 'won' && (
          <button className="btn-slip btn-collect" disabled={busy} onClick={onWithdraw}>
            {busy ? 'CONFIRM IN WALLET…' : `COLLECT YOUR STAKE — ${stakeStr}`}
          </button>
        )}
        {final && (
          <div className="final-block">
            <div className="final-copy">
              {phase === 'completed'
                ? `${stakeStr} returned to you. The habit paid.`
                : `${stakeStr} went to ${short(c.beneficiary)}. No refunds — that’s the point.`}
            </div>
            <button className="btn-new" onClick={onNew}>WRITE A NEW SLIP</button>
          </div>
        )}

        {phase === 'completed' && <div className="stamp paid">PAID</div>}
        {phase === 'slashed' && <div className="stamp slashed">SLASHED</div>}
      </div>
      <div className="perf-bottom" />
    </div>
  );
}
