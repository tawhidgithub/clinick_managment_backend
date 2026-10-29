import sharp from 'sharp';
import { badRequest } from '../errors/AppError';

const MAX_EDGE_PX = 2000;
const JPEG_QUALITY = 80;

export interface ProcessedImage {
  data: Buffer;
  contentType: 'image/jpeg';
  width: number;
  height: number;
}

/**
 * Normalises a phone/tablet photo of a prescription: applies the camera's
 * rotation, shrinks it to at most 2000px on the long edge, strips metadata
 * (location etc.) and saves it as JPEG. A 5 MB photo typically ends up ~300 KB.
 */
export async function compressPhoto(input: Buffer, originalName = 'image'): Promise<ProcessedImage> {
  try {
    const { data, info } = await sharp(input, { failOn: 'error' })
      .rotate()
      .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { data, contentType: 'image/jpeg', width: info.width, height: info.height };
  } catch {
    throw badRequest(`"${originalName}" is not a readable image. Use a JPG, PNG or WebP photo.`);
  }
}
