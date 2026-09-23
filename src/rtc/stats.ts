// Ermittelt per getStats, wie die Verbindung läuft: lokal, über das Internet oder über ein Relay.

export type ConnectionType = 'lan' | 'internet' | 'relay';

interface CandidateInfo {
  candidateType?: string;
  address?: string;
  ip?: string;
}

/** Private, Link-Local- und mDNS-Adressen gelten als lokal. */
export function isLocalAddress(address: string | undefined): boolean {
  if (!address) return false;
  const a = address.toLowerCase();
  if (a.endsWith('.local')) return true;
  if (/^10\./.test(a) || /^192\.168\./.test(a) || /^169\.254\./.test(a) || /^127\./.test(a)) return true;
  const m = /^172\.(\d+)\./.exec(a);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a)) return false; // CGNAT ist nicht "lokal"
  if (a.includes(':')) return a.startsWith('fe80:') || a.startsWith('fc') || a.startsWith('fd') || a === '::1';
  return false;
}

export function classifyPair(local: CandidateInfo | undefined, remote: CandidateInfo | undefined): ConnectionType | null {
  if (!local || !remote) return null;
  if (local.candidateType === 'relay' || remote.candidateType === 'relay') return 'relay';
  const remoteAddr = remote.address ?? remote.ip;
  if (local.candidateType === 'host' && (remote.candidateType === 'host' || isLocalAddress(remoteAddr))) return 'lan';
  return 'internet';
}

type StatsEntry = Record<string, unknown> & { id: string; type: string };

export async function getConnectionType(pc: RTCPeerConnection): Promise<ConnectionType | null> {
  const report = await pc.getStats();
  const entries = new Map<string, StatsEntry>();
  report.forEach((v: StatsEntry) => entries.set(v.id, v));

  let pair: StatsEntry | undefined;
  for (const e of entries.values()) {
    if (e.type === 'transport' && typeof e.selectedCandidatePairId === 'string') {
      pair = entries.get(e.selectedCandidatePairId);
      if (pair) break;
    }
  }
  if (!pair) {
    for (const e of entries.values()) {
      // Firefox: "selected"; sonst nominiertes, erfolgreiches Paar
      if (e.type === 'candidate-pair' && (e.selected === true || (e.nominated === true && e.state === 'succeeded'))) {
        pair = e;
        break;
      }
    }
  }
  if (!pair) return null;
  const local = entries.get(String(pair.localCandidateId)) as CandidateInfo | undefined;
  const remote = entries.get(String(pair.remoteCandidateId)) as CandidateInfo | undefined;
  return classifyPair(local, remote);
}
