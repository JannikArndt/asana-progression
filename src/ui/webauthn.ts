/**
 * Passkeys in the browser: the server's options (JSON, base64url) → navigator.credentials →
 * the JSON the server verifies. Uses the platform's JSON helpers where they exist.
 */

const b64url = {
  encode(buf: ArrayBuffer | ArrayBufferView): string {
    const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(s: string): ArrayBuffer {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  },
};

type Json = Record<string, unknown>;
interface CredDescriptorJson {
  id: string;
  type?: string;
  transports?: string[];
}

interface PkcStatic {
  parseCreationOptionsFromJSON?: (o: Json) => PublicKeyCredentialCreationOptions;
  parseRequestOptionsFromJSON?: (o: Json) => PublicKeyCredentialRequestOptions;
}

const descriptors = (list: unknown) =>
  ((list as CredDescriptorJson[] | undefined) ?? []).map((c) => ({ ...c, type: 'public-key' as const, id: b64url.decode(c.id), transports: c.transports as AuthenticatorTransport[] | undefined }));

export function passkeysAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && !!navigator.credentials;
}

function toJson(cred: PublicKeyCredential): Json {
  const withJson = cred as unknown as { toJSON?: () => unknown };
  if (typeof withJson.toJSON === 'function') return withJson.toJSON() as unknown as Json;
  const r = cred.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse;
  const response: Json = { clientDataJSON: b64url.encode(r.clientDataJSON) };
  if ('attestationObject' in r && r.attestationObject) {
    response.attestationObject = b64url.encode(r.attestationObject);
    response.transports = typeof r.getTransports === 'function' ? r.getTransports() : [];
  } else {
    response.authenticatorData = b64url.encode(r.authenticatorData);
    response.signature = b64url.encode(r.signature);
    if (r.userHandle) response.userHandle = b64url.encode(r.userHandle);
  }
  return {
    id: cred.id,
    rawId: b64url.encode(cred.rawId),
    type: cred.type,
    response,
    clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
  };
}

export async function createPasskey(options: Json): Promise<Json> {
  const P = PublicKeyCredential as unknown as PkcStatic;
  const publicKey: PublicKeyCredentialCreationOptions = P.parseCreationOptionsFromJSON
    ? P.parseCreationOptionsFromJSON(options)
    : {
        ...(options as unknown as PublicKeyCredentialCreationOptions),
        challenge: b64url.decode(options.challenge as string),
        user: { ...(options.user as Json), id: b64url.decode((options.user as Json).id as string) } as PublicKeyCredentialUserEntity,
        excludeCredentials: descriptors(options.excludeCredentials),
      };
  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error('No passkey was created');
  return toJson(cred);
}

export async function getPasskey(options: Json): Promise<Json> {
  const P = PublicKeyCredential as unknown as PkcStatic;
  const publicKey: PublicKeyCredentialRequestOptions = P.parseRequestOptionsFromJSON
    ? P.parseRequestOptionsFromJSON(options)
    : {
        ...(options as unknown as PublicKeyCredentialRequestOptions),
        challenge: b64url.decode(options.challenge as string),
        allowCredentials: descriptors(options.allowCredentials),
      };
  const cred = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error('No passkey was chosen');
  return toJson(cred);
}
