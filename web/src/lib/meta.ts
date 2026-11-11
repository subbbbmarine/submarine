'use client';

import { API_URL } from './config';

/** A picture for a token, made small enough to show fast everywhere. A GIF is kept whole, since redrawing it would stop it moving. */
const SIDE = 512;
const MOST = 2 * 1024 * 1024;

export async function pictureToData(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Use a PNG, JPEG, WebP or GIF');
  if (file.type === 'image/gif') {
    if (file.size > MOST) throw new Error('That GIF is over 2 MB');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("That picture couldn't be read"));
      reader.readAsDataURL(file);
    });
  }
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That picture couldn't be read");
  });
  const scale = Math.min(1, SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // Browsers that can't write WebP hand back a PNG, which is just as good here.
  return canvas.toDataURL('image/webp', 0.9);
}

export interface TokenMeta {
  image?: string;
  imageUrl?: string;
  description?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
}

/** Saves what doesn't fit on the chain, and returns the address to launch the token with. */
export async function saveMeta(meta: TokenMeta): Promise<{ uri: string; image?: string }> {
  const res = await fetch(`${API_URL}/api/v1/meta`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(meta) });
  const body = (await res.json().catch(() => ({}))) as { uri?: string; image?: string; message?: string };
  if (!res.ok || !body.uri) throw new Error(body.message ?? "The picture and details couldn't be saved. Nothing was sent, try again.");
  return { uri: body.uri, image: body.image };
}
