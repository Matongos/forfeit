import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatEther, parseEther } from 'viem';
import {
  ABI, CHAIN, CONTRACT, EXPLORER, publicClient, readCommitment, nextId,
  short, walletClient, type Commitment,
} from './lib/contract';

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 250);
    return () => clearInterval(t);
  }, []);
  return now;
}

function fmt(secs: number) {
  if (secs < 0) secs = 0;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

async function ensureChain(eth: any) {
  const hex = '0x' + CHAIN.id.toString(16);
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (e: any) {
    if (e?.code === 4902) {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: hex,
          chainName: CHAIN.name,
          nativeCurrency: CHAIN.nativeCurrency,
          rpcUrls: [CHAIN.rpcUrls.default.http[0]],
          blockExplorerUrls: [EXPLORER],
        }],
      });
    } else throw e;
  }
}

export default function App() {
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [id, setId] = useState<bigint | null>(null);
  const [c, setC] = useState<Commitment | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [lastTx, setLastTx] = useState('');
  const now = useNow();

  const connect = useCallback(async () => {
    const eth = (window as any).ethereum;
    if (!eth) { setErr('No wallet found — install MetaMask'); return; }
    const [a] = await eth.request({ method: 'eth_requestAccounts' });
    await ensureChain(eth);
    setAccount(a);
  }, []);

  // find the caller's most recent commitment
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
    setBusy(true); setErr('');
    try {
      const wc = walletClient();
      const [a] = await wc.requestAddresses();
      const hash = await wc.writeContract({
        address: CONTRACT, abi: ABI, functionName: fn, args, value, account: a,
      });
      setLastTx(hash);
      await publicClient.waitForTransactionReceipt({ hash });
      await refresh();
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return (
    <div className="page">
      <header>
        <span className="wordmark">FORFEIT</span>
        <span className="tagline">stake MON on your own discipline</span>
        {account
          ? <span className="addr">{short(account)}</span>
          : <button className="btn" onClick={connect}>Connect wallet</button>}
      </header>

      {!account && (
        <div className="slip intro">
          <p>Lock a stake. Check in every window, or your friend takes the pot.</p>
          <p className="fine">No refunds. No support line. That's the point.</p>
        </div>
      )}

      {account && !c && <CreateForm onCreate={(args, value) => send('create', args, value)} busy={busy} />}

      {account && c && id !== null && (
        <SlipCard
          id={id} c={c} now={now} account={account} busy={busy}
          onCheckIn={() => send('checkIn', [id])}
          onSlash={() => send('slash', [id])}
          onWithdraw={() => send('withdraw', [id])}
          onNew={() => { setId(null); setC(null); }}
        />
      )}

      {err && <p className="error">{err}</p>}
      {lastTx && (
        <p className="fine center">
          last tx: <a href={`${EXPLORER}/tx/${lastTx}`} target="_blank" rel="noreferrer">{short(lastTx)}</a>
        </p>
      )}
      <footer className="fine center">
        contract <a href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer">{short(CONTRACT)}</a> · Monad testnet
      </footer>
    </div>
  );
}

function CreateForm({ onCreate, busy }: {
  onCreate: (args: any[], value: bigint) => void; busy: boolean;
}) {
  const [habit, setHabit] = useState('');
  const [stake, setStake] = useState('1');
  const [beneficiary, setBeneficiary] = useState('');
  const [windowH, setWindowH] = useState('48');
  const [minGapH, setMinGapH] = useState('16');
  const [required, setRequired] = useState('7');
  const [demo, setDemo] = useState(false);

  const submit = () => {
    const w = demo ? 90 : Math.round(Number(windowH) * 3600);
    const g = demo ? 20 : Math.round(Number(minGapH) * 3600);
    const r = demo ? 2 : Number(required);
    onCreate([beneficiary, w, g, r, false, habit || 'do the thing'], parseEther(stake));
  };

  return (
    <div className="slip">
      <div className="slip-head">NEW WAGER SLIP</div>
      <label>HABIT<input value={habit} onChange={(e) => setHabit(e.target.value)} placeholder="gym every day" /></label>
      <label>STAKE (MON)<input value={stake} onChange={(e) => setStake(e.target.value)} /></label>
      <label>PAYS ON FAILURE (friend's address)
        <input value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} placeholder="0x…" /></label>
      {!demo && (
        <div className="row">
          <label>WINDOW (h)<input value={windowH} onChange={(e) => setWindowH(e.target.value)} /></label>
          <label>MIN GAP (h)<input value={minGapH} onChange={(e) => setMinGapH(e.target.value)} /></label>
          <label>CHECK-INS<input value={required} onChange={(e) => setRequired(e.target.value)} /></label>
        </div>
      )}
      <label className="checkbox">
        <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
        Demo preset (90s window · 20s gap · 2 check-ins)
      </label>
      <button className="btn primary" disabled={busy || !beneficiary} onClick={submit}>
        {busy ? 'Confirm in wallet…' : `Lock ${stake} MON`}
      </button>
    </div>
  );
}

function SlipCard({ id, c, now, account, busy, onCheckIn, onSlash, onWithdraw, onNew }: {
  id: bigint; c: Commitment; now: number; account: string; busy: boolean;
  onCheckIn: () => void; onSlash: () => void; onWithdraw: () => void; onNew: () => void;
}) {
  const last = Number(c.lastCheckIn);
  const deadline = last + c.window;
  const gapEnds = last + c.minGap;
  const won = c.done >= c.required;
  const overdue = c.status === 0 && !won && now > deadline;
  const inGap = now < gapEnds;
  const stamped = c.status === 1 ? 'PAID' : c.status === 2 ? 'SLASHED' : won ? 'WON' : null;

  const ticks = useMemo(() =>
    Array.from({ length: c.required }, (_, i) => i < c.done), [c.required, c.done]);

  return (
    <div className={`slip ${overdue ? 'alarm' : ''}`}>
      <div className="slip-head">WAGER SLIP #{id.toString()}</div>
      <div className="habit">{c.habit.toUpperCase()}</div>
      <div className="terms">
        STAKE: {formatEther(c.stake === 0n && c.status !== 0 ? getOriginal(c) : c.stake)} MON · WINDOW: {fmtDur(c.window)} · PAYS: {short(c.beneficiary)}
      </div>
      <div className="ticks">
        {ticks.map((t, i) => <span key={i} className={t ? 'tick done' : 'tick'}>{t ? '✕' : '○'}</span>)}
        <span className="tick-label">{c.done}/{c.required}</span>
      </div>

      {c.status === 0 && !won && (
        <div className={`countdown ${overdue ? 'red' : ''}`}>
          {overdue ? 'WINDOW BLOWN' : fmt(deadline - now)}
        </div>
      )}

      {c.status === 0 && !won && !overdue && (
        <button className="btn primary" disabled={busy || inGap} onClick={onCheckIn}>
          {busy ? 'Confirm in wallet…' : inGap ? `next check-in opens in ${fmt(gapEnds - now)}` : 'Check in'}
        </button>
      )}
      {overdue && (
        <button className="btn danger" disabled={busy} onClick={onSlash}>
          {busy ? 'Confirm in wallet…' : 'Claim their stake'}
        </button>
      )}
      {c.status === 0 && won && (
        <button className="btn primary" disabled={busy || account.toLowerCase() !== c.owner.toLowerCase()} onClick={onWithdraw}>
          {busy ? 'Confirm in wallet…' : 'Collect your stake'}
        </button>
      )}
      {c.status === 2 && <p className="fine center">stake went to {short(c.beneficiary)}</p>}
      {c.status !== 0 && <button className="btn" onClick={onNew}>New slip</button>}

      {stamped && <div className={`stamp ${stamped === 'SLASHED' ? 'red' : 'green'}`}>{stamped}</div>}
    </div>
  );
}

// stake is zeroed on payout; keep showing something sensible on final slips
function getOriginal(c: Commitment) { return c.stake; }

function fmtDur(s: number) {
  if (s % 3600 === 0) return `${s / 3600}H`;
  return `${s}S`;
}
