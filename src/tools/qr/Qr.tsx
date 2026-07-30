import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import { ToolShell } from '@shared/components/ToolShell.tsx';
import { CopyButton } from '@shared/components/CopyButton.tsx';
import { Segmented } from '@shared/components/Segmented.tsx';
import {
  PAYLOAD_KINDS,
  PAYLOAD_NAMES,
  buildEmail,
  buildEvent,
  buildGeo,
  buildSms,
  buildTotp,
  buildVcard,
  buildWifi,
  randomBase32Secret,
  validateBase32,
  type PayloadKind,
} from './payloads.ts';

type EcLevel = 'L' | 'M' | 'Q' | 'H';

const EC_NOTES: Record<EcLevel, string> = {
  L: '~7% recoverable — smallest code, use only for clean digital display',
  M: '~15% recoverable — the usual default',
  Q: '~25% recoverable — good for print',
  H: '~30% recoverable — needed if you overlay a logo',
};

interface Fields {
  text: string;
  url: string;
  wifiSsid: string;
  wifiPassword: string;
  wifiSecurity: 'WPA' | 'WEP' | 'nopass';
  wifiHidden: boolean;
  firstName: string;
  lastName: string;
  organisation: string;
  jobTitle: string;
  phone: string;
  email: string;
  contactUrl: string;
  eventSummary: string;
  eventLocation: string;
  eventStart: string;
  eventEnd: string;
  emailTo: string;
  emailSubject: string;
  emailBody: string;
  smsNumber: string;
  smsMessage: string;
  tel: string;
  lat: string;
  lon: string;
  totpIssuer: string;
  totpAccount: string;
  totpSecret: string;
  totpAlgorithm: 'SHA1' | 'SHA256' | 'SHA512';
  totpDigits: 6 | 8;
  totpPeriod: number;
}

const EMPTY: Fields = {
  text: 'Hello from tools',
  url: 'https://example.com',
  wifiSsid: '',
  wifiPassword: '',
  wifiSecurity: 'WPA',
  wifiHidden: false,
  firstName: '',
  lastName: '',
  organisation: '',
  jobTitle: '',
  phone: '',
  email: '',
  contactUrl: '',
  eventSummary: '',
  eventLocation: '',
  eventStart: '',
  eventEnd: '',
  emailTo: '',
  emailSubject: '',
  emailBody: '',
  smsNumber: '',
  smsMessage: '',
  tel: '',
  lat: '51.5074',
  lon: '-0.1278',
  totpIssuer: 'Example',
  totpAccount: 'user@example.com',
  totpSecret: 'JBSWY3DPEHPK3PXP',
  totpAlgorithm: 'SHA1',
  totpDigits: 6,
  totpPeriod: 30,
};

function buildPayload(kind: PayloadKind, f: Fields): string {
  switch (kind) {
    case 'text': return f.text;
    case 'url': return f.url;
    case 'wifi':
      return buildWifi({
        ssid: f.wifiSsid,
        password: f.wifiPassword,
        security: f.wifiSecurity,
        hidden: f.wifiHidden,
      });
    case 'vcard':
      return buildVcard({
        firstName: f.firstName,
        lastName: f.lastName,
        organisation: f.organisation,
        title: f.jobTitle,
        phone: f.phone,
        email: f.email,
        url: f.contactUrl,
      });
    case 'event':
      return buildEvent({
        summary: f.eventSummary,
        location: f.eventLocation,
        start: f.eventStart,
        end: f.eventEnd,
      });
    case 'email': return buildEmail(f.emailTo, f.emailSubject, f.emailBody);
    case 'sms': return buildSms(f.smsNumber, f.smsMessage);
    case 'tel': return `tel:${f.tel}`;
    case 'geo': return buildGeo(f.lat, f.lon);
    case 'totp':
      return buildTotp({
        issuer: f.totpIssuer,
        account: f.totpAccount,
        secret: f.totpSecret,
        algorithm: f.totpAlgorithm,
        digits: f.totpDigits,
        period: f.totpPeriod,
      });
  }
}

export function Qr() {
  const [tab, setTab] = useState<'generate' | 'decode'>('generate');
  const [kind, setKind] = useState<PayloadKind>('text');
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [ec, setEc] = useState<EcLevel>('M');
  const [scale, setScale] = useState(6);
  const [margin, setMargin] = useState(2);

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const payload = useMemo(() => buildPayload(kind, fields), [kind, fields]);
  const secretError = kind === 'totp' ? validateBase32(fields.totpSecret) : null;

  const [svg, setSvg] = useState('');
  const [pngUri, setPngUri] = useState('');
  const [genError, setGenError] = useState<string | null>(null);

  useEffect(() => {
    if (!payload) {
      setSvg('');
      setPngUri('');
      return;
    }
    let cancelled = false;
    setGenError(null);

    const options = { errorCorrectionLevel: ec, margin, scale };

    Promise.all([
      QRCode.toString(payload, { ...options, type: 'svg' }),
      QRCode.toDataURL(payload, { ...options, type: 'image/png' }),
    ])
      .then(([svgOut, pngOut]) => {
        if (cancelled) return;
        setSvg(svgOut);
        setPngUri(pngOut);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSvg('');
        setPngUri('');
        // Most commonly: the payload exceeds what a QR code can hold at this EC level.
        setGenError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [payload, ec, margin, scale]);

  return (
    <ToolShell slug="qr" wide>
      <div class="stack">
        <Segmented
          label="Mode"
          options={['generate', 'decode'] as const}
          value={tab}
          names={{ generate: 'Generate', decode: 'Decode' }}
          onChange={setTab}
        />

        {tab === 'generate' ? (
          <div class="grid-2">
            <div class="stack">
              <label class="row row--tight small">
                <span class="field__label">Payload</span>
                <select
                  value={kind}
                  onChange={(e) => setKind((e.target as HTMLSelectElement).value as PayloadKind)}
                >
                  {PAYLOAD_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {PAYLOAD_NAMES[k]}
                    </option>
                  ))}
                </select>
              </label>

              {kind === 'text' && (
                <label class="field">
                  <span class="field__label">Text</span>
                  <textarea value={fields.text} onInput={(e) => set('text', (e.target as HTMLTextAreaElement).value)} />
                </label>
              )}

              {kind === 'url' && (
                <label class="field">
                  <span class="field__label">URL</span>
                  <input type="text" value={fields.url} onInput={(e) => set('url', (e.target as HTMLInputElement).value)} />
                </label>
              )}

              {kind === 'wifi' && (
                <>
                  <label class="field">
                    <span class="field__label">Network name (SSID)</span>
                    <input type="text" value={fields.wifiSsid} onInput={(e) => set('wifiSsid', (e.target as HTMLInputElement).value)} />
                  </label>
                  <label class="row row--tight small">
                    <span class="field__label">Security</span>
                    <select
                      value={fields.wifiSecurity}
                      onChange={(e) => set('wifiSecurity', (e.target as HTMLSelectElement).value as Fields['wifiSecurity'])}
                    >
                      <option value="WPA">WPA/WPA2/WPA3</option>
                      <option value="WEP">WEP</option>
                      <option value="nopass">Open (no password)</option>
                    </select>
                  </label>
                  {fields.wifiSecurity !== 'nopass' && (
                    <label class="field">
                      <span class="field__label">Password</span>
                      <input type="text" value={fields.wifiPassword} onInput={(e) => set('wifiPassword', (e.target as HTMLInputElement).value)} />
                    </label>
                  )}
                  <label class="checkbox">
                    <input type="checkbox" checked={fields.wifiHidden} onChange={(e) => set('wifiHidden', (e.target as HTMLInputElement).checked)} />
                    Hidden network
                  </label>
                </>
              )}

              {kind === 'vcard' && (
                <>
                  <div class="grid-2">
                    <label class="field">
                      <span class="field__label">First name</span>
                      <input type="text" value={fields.firstName} onInput={(e) => set('firstName', (e.target as HTMLInputElement).value)} />
                    </label>
                    <label class="field">
                      <span class="field__label">Last name</span>
                      <input type="text" value={fields.lastName} onInput={(e) => set('lastName', (e.target as HTMLInputElement).value)} />
                    </label>
                  </div>
                  <label class="field">
                    <span class="field__label">Organisation</span>
                    <input type="text" value={fields.organisation} onInput={(e) => set('organisation', (e.target as HTMLInputElement).value)} />
                  </label>
                  <label class="field">
                    <span class="field__label">Job title</span>
                    <input type="text" value={fields.jobTitle} onInput={(e) => set('jobTitle', (e.target as HTMLInputElement).value)} />
                  </label>
                  <label class="field">
                    <span class="field__label">Phone</span>
                    <input type="text" value={fields.phone} onInput={(e) => set('phone', (e.target as HTMLInputElement).value)} />
                  </label>
                  <label class="field">
                    <span class="field__label">Email</span>
                    <input type="text" value={fields.email} onInput={(e) => set('email', (e.target as HTMLInputElement).value)} />
                  </label>
                </>
              )}

              {kind === 'event' && (
                <>
                  <label class="field">
                    <span class="field__label">Summary</span>
                    <input type="text" value={fields.eventSummary} onInput={(e) => set('eventSummary', (e.target as HTMLInputElement).value)} />
                  </label>
                  <label class="field">
                    <span class="field__label">Location</span>
                    <input type="text" value={fields.eventLocation} onInput={(e) => set('eventLocation', (e.target as HTMLInputElement).value)} />
                  </label>
                  <div class="grid-2">
                    <label class="field">
                      <span class="field__label">Start</span>
                      <input type="datetime-local" value={fields.eventStart} onInput={(e) => set('eventStart', (e.target as HTMLInputElement).value)} />
                    </label>
                    <label class="field">
                      <span class="field__label">End</span>
                      <input type="datetime-local" value={fields.eventEnd} onInput={(e) => set('eventEnd', (e.target as HTMLInputElement).value)} />
                    </label>
                  </div>
                </>
              )}

              {kind === 'email' && (
                <>
                  <label class="field">
                    <span class="field__label">To</span>
                    <input type="text" value={fields.emailTo} onInput={(e) => set('emailTo', (e.target as HTMLInputElement).value)} />
                  </label>
                  <label class="field">
                    <span class="field__label">Subject</span>
                    <input type="text" value={fields.emailSubject} onInput={(e) => set('emailSubject', (e.target as HTMLInputElement).value)} />
                  </label>
                  <label class="field">
                    <span class="field__label">Body</span>
                    <textarea value={fields.emailBody} onInput={(e) => set('emailBody', (e.target as HTMLTextAreaElement).value)} />
                  </label>
                </>
              )}

              {kind === 'sms' && (
                <>
                  <label class="field">
                    <span class="field__label">Number</span>
                    <input type="text" value={fields.smsNumber} onInput={(e) => set('smsNumber', (e.target as HTMLInputElement).value)} />
                  </label>
                  <label class="field">
                    <span class="field__label">Message</span>
                    <textarea value={fields.smsMessage} onInput={(e) => set('smsMessage', (e.target as HTMLTextAreaElement).value)} />
                  </label>
                </>
              )}

              {kind === 'tel' && (
                <label class="field">
                  <span class="field__label">Phone number</span>
                  <input type="text" value={fields.tel} onInput={(e) => set('tel', (e.target as HTMLInputElement).value)} />
                </label>
              )}

              {kind === 'geo' && (
                <div class="grid-2">
                  <label class="field">
                    <span class="field__label">Latitude</span>
                    <input type="text" value={fields.lat} onInput={(e) => set('lat', (e.target as HTMLInputElement).value)} />
                  </label>
                  <label class="field">
                    <span class="field__label">Longitude</span>
                    <input type="text" value={fields.lon} onInput={(e) => set('lon', (e.target as HTMLInputElement).value)} />
                  </label>
                </div>
              )}

              {kind === 'totp' && (
                <>
                  <div class="note note--ok small">
                    Seeds an authenticator app against a test IdP. The secret stays in this page.
                  </div>
                  <label class="field">
                    <span class="field__label">Issuer</span>
                    <input type="text" value={fields.totpIssuer} onInput={(e) => set('totpIssuer', (e.target as HTMLInputElement).value)} />
                  </label>
                  <label class="field">
                    <span class="field__label">Account</span>
                    <input type="text" value={fields.totpAccount} onInput={(e) => set('totpAccount', (e.target as HTMLInputElement).value)} />
                  </label>
                  <label class="field">
                    <span class="field__label">Secret (base32)</span>
                    <input type="text" value={fields.totpSecret} onInput={(e) => set('totpSecret', (e.target as HTMLInputElement).value)} />
                  </label>
                  <div class="row">
                    <button type="button" onClick={() => set('totpSecret', randomBase32Secret())}>
                      Random secret
                    </button>
                    <label class="row row--tight small">
                      <span class="field__label">Algo</span>
                      <select
                        value={fields.totpAlgorithm}
                        onChange={(e) => set('totpAlgorithm', (e.target as HTMLSelectElement).value as Fields['totpAlgorithm'])}
                      >
                        <option value="SHA1">SHA1</option>
                        <option value="SHA256">SHA256</option>
                        <option value="SHA512">SHA512</option>
                      </select>
                    </label>
                    <label class="row row--tight small">
                      <span class="field__label">Digits</span>
                      <select
                        value={String(fields.totpDigits)}
                        onChange={(e) => set('totpDigits', Number((e.target as HTMLSelectElement).value) as 6 | 8)}
                      >
                        <option value="6">6</option>
                        <option value="8">8</option>
                      </select>
                    </label>
                    <label class="row row--tight small">
                      <span class="field__label">Period</span>
                      <input
                        type="number"
                        min={10}
                        max={120}
                        value={fields.totpPeriod}
                        onInput={(e) => set('totpPeriod', Number((e.target as HTMLInputElement).value))}
                      />
                    </label>
                  </div>
                  {secretError && <div class="note note--error">{secretError}</div>}
                </>
              )}

              <hr style="border:none;border-top:1px solid var(--border);margin:4px 0" />

              <div class="row">
                <Segmented
                  label="Error correction"
                  options={['L', 'M', 'Q', 'H'] as const}
                  value={ec}
                  onChange={setEc}
                />
                <label class="row row--tight small">
                  <span class="field__label">Scale</span>
                  <input type="number" min={1} max={20} value={scale} onInput={(e) => setScale(Number((e.target as HTMLInputElement).value))} />
                </label>
                <label class="row row--tight small">
                  <span class="field__label">Margin</span>
                  <input type="number" min={0} max={10} value={margin} onInput={(e) => setMargin(Number((e.target as HTMLInputElement).value))} />
                </label>
              </div>
              <p class="small faint" style="margin:0">{EC_NOTES[ec]}</p>
            </div>

            <div class="stack">
              {genError ? (
                <div class="note note--error">{genError}</div>
              ) : (
                <>
                  <div
                    class="panel"
                    style="display:flex;align-items:center;justify-content:center;background:#fff"
                    // The SVG comes from qrcode's own serialiser, not user input —
                    // the payload is encoded into path data, never interpolated as markup.
                    dangerouslySetInnerHTML={{ __html: svg }}
                  />
                  <div class="row">
                    <CopyButton value={svg} label="Copy SVG" />
                    <CopyButton value={payload} label="Copy payload" />
                    {pngUri && (
                      <a href={pngUri} download="qr.png">
                        <button type="button">Download PNG</button>
                      </a>
                    )}
                  </div>
                </>
              )}
              <label class="field">
                <span class="field__label">Encoded payload ({payload.length} chars)</span>
                <pre class="output" style="min-height:0">{payload}</pre>
              </label>
            </div>
          </div>
        ) : (
          <Decoder />
        )}
      </div>
    </ToolShell>
  );
}

/** Decode from a file, a paste, or the camera. */
function Decoder() {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const decodeImageData = async (data: ImageData) => {
    const { default: jsQR } = await import('jsqr');
    const found = jsQR(data.data, data.width, data.height);
    if (found) {
      setResult(found.data);
      setError(null);
      return true;
    }
    return false;
  };

  const handleFile = async (file: File) => {
    setError(null);
    setResult(null);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get a 2D canvas context.');
      ctx.drawImage(bitmap, 0, 0);
      const ok = await decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (!ok) setError('No QR code found in that image.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Camera scanning loop.
  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;

    const tick = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!stopped && video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          const found = await decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
          if (found) {
            setScanning(false);
            return;
          }
        }
      }
      if (!stopped) raf = requestAnimationFrame(() => void tick());
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          return videoRef.current.play();
        }
      })
      .then(() => void tick())
      .catch((err: unknown) => {
        setScanning(false);
        setError(
          err instanceof Error
            ? `Camera unavailable: ${err.message}`
            : 'Camera unavailable.',
        );
      });

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [scanning]);

  // Accept a pasted screenshot.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.items ?? [])]
        .find((i) => i.type.startsWith('image/'))
        ?.getAsFile();
      if (file) void handleFile(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  return (
    <div class="stack">
      <div class="note note--ok small">
        Decoding happens in this page. Drop an image, paste a screenshot, or use the camera.
      </div>

      <div class="row">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <button type="button" class={scanning ? '' : 'primary'} onClick={() => setScanning((v) => !v)}>
          {scanning ? 'Stop camera' : 'Scan with camera'}
        </button>
      </div>

      {scanning && (
        <div class="panel">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} muted playsInline style="width:100%;max-width:420px;border-radius:6px" />
        </div>
      )}
      <canvas ref={canvasRef} style="display:none" />

      {error && <div class="note note--error">{error}</div>}

      {result !== null && (
        <div class="stack stack--tight">
          <div class="row">
            <span class="field__label">Decoded</span>
            <span class="topbar__spacer" />
            <CopyButton value={result} />
          </div>
          <pre class="output">{result}</pre>
        </div>
      )}
    </div>
  );
}
