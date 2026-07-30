import { useEffect, useMemo, useState } from 'preact/hooks';
import { ToolShell } from '@shared/components/ToolShell.tsx';
import { CopyButton } from '@shared/components/CopyButton.tsx';
import { Segmented } from '@shared/components/Segmented.tsx';
import { useHashState } from '@shared/hooks/useHashState.ts';
import {
  checkAlgorithm,
  decode,
  describeClaims,
  verify,
  type DecodedJwt,
  type KeyFormat,
  type VerifyResult,
} from './jwt.ts';

const KEY_FORMAT_NAMES: Record<KeyFormat, string> = {
  secret: 'Shared secret',
  jwk: 'JWK / JWKS',
  pem: 'PEM public key',
};

const KEY_PLACEHOLDERS: Record<KeyFormat, string> = {
  secret: 'The HMAC secret…',
  jwk: '{"kty":"RSA","n":"…","e":"AQAB"}  or a full JWKS document',
  pem: '-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----',
};

export function Jwt() {
  // Only the token goes in the URL; the key never does.
  const [state, setState] = useHashState<{ token: string }>({ token: '' });
  const token = state.token;

  const [keyFormat, setKeyFormat] = useState<KeyFormat>('secret');
  const [keyInput, setKeyInput] = useState('');

  const decoded = useMemo((): { ok: DecodedJwt } | { error: string } | null => {
    if (!token.trim()) return null;
    try {
      return { ok: decode(token) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [token]);

  const jwt = decoded && 'ok' in decoded ? decoded.ok : null;
  const algWarning = jwt ? checkAlgorithm(jwt.header) : null;
  const claims = jwt ? describeClaims(jwt.payload) : [];

  const [result, setResult] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  // Clear a stale verdict whenever the inputs change.
  useEffect(() => setResult(null), [token, keyInput, keyFormat]);

  const runVerify = async () => {
    setVerifying(true);
    try {
      setResult(await verify(token, keyInput, keyFormat));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <ToolShell slug="jwt" wide>
      <div class="stack">
        <label class="field">
          <span class="field__label">Token</span>
          <textarea
            value={token}
            spellcheck={false}
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…"
            style="min-height:110px"
            onInput={(e) => setState({ token: (e.target as HTMLTextAreaElement).value })}
          />
        </label>

        {decoded && 'error' in decoded && <div class="note note--error">{decoded.error}</div>}

        {jwt && (
          <>
            {algWarning && (
              <div class={algWarning.level === 'error' ? 'note note--error' : 'note note--warn'}>
                {algWarning.message}
              </div>
            )}

            <div class="note note--warn small">
              Decoding is not verification. A JWT's claims are readable by anyone — they only mean
              something once the signature checks out below.
            </div>

            <div class="grid-2">
              <div class="stack stack--tight">
                <div class="row">
                  <span class="field__label">Header</span>
                  <span class="topbar__spacer" />
                  <CopyButton value={JSON.stringify(jwt.header, null, 2)} />
                </div>
                <pre class="output">{JSON.stringify(jwt.header, null, 2)}</pre>
              </div>

              <div class="stack stack--tight">
                <div class="row">
                  <span class="field__label">Payload</span>
                  <span class="topbar__spacer" />
                  <CopyButton value={JSON.stringify(jwt.payload, null, 2)} />
                </div>
                <pre class="output">{JSON.stringify(jwt.payload, null, 2)}</pre>
              </div>
            </div>

            {claims.length > 0 && (
              <div class="table-scroll">
                <table class="data">
                  <thead>
                    <tr>
                      <th style="width:8rem">Claim</th>
                      <th style="width:20rem">Value</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claims.map((c) => (
                      <tr key={c.claim}>
                        <td>
                          <span class="mono">{c.claim}</span>{' '}
                          <span class="faint small">{c.label}</span>
                        </td>
                        <td class="mono wrap-anywhere">{c.value}</td>
                        <td
                          style={
                            c.status === 'error'
                              ? 'color:var(--danger)'
                              : c.status === 'warn'
                                ? 'color:var(--warn)'
                                : c.status === 'ok'
                                  ? 'color:var(--ok)'
                                  : undefined
                          }
                        >
                          {c.detail ?? (c.status === 'ok' ? 'OK' : '')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <fieldset class="panel">
              <legend class="field__label">Verify signature</legend>
              <div class="stack">
                <Segmented
                  label="Key format"
                  options={['secret', 'jwk', 'pem'] as const}
                  value={keyFormat}
                  names={KEY_FORMAT_NAMES}
                  onChange={setKeyFormat}
                />
                <textarea
                  value={keyInput}
                  spellcheck={false}
                  placeholder={KEY_PLACEHOLDERS[keyFormat]}
                  style="min-height:80px"
                  onInput={(e) => setKeyInput((e.target as HTMLTextAreaElement).value)}
                />
                <div class="row">
                  <button
                    type="button"
                    class="primary"
                    disabled={!keyInput.trim() || verifying}
                    onClick={() => void runVerify()}
                  >
                    {verifying ? 'Verifying…' : 'Verify'}
                  </button>
                  <span class="small faint">
                    The key is never written to the URL or sent anywhere.
                  </span>
                </div>
                {result && (
                  <div class={result.valid ? 'note note--ok' : 'note note--error'}>
                    {result.valid ? '✓ ' : '✗ '}
                    {result.message}
                  </div>
                )}
              </div>
            </fieldset>
          </>
        )}
      </div>
    </ToolShell>
  );
}
