const GIF_WIDTH = 240;
const GIF_FRAME_COUNT = 10;
const GIF_FRAME_DELAY = 20; // hundredths of a second

function waitForVideo(video: HTMLVideoElement, event: 'loadeddata' | 'seeked') {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('Video thumbnail timed out.')), 8_000);
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      video.removeEventListener(event, onReady);
      video.removeEventListener('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => finish();
    const onError = () => finish(new Error('The browser could not decode the video thumbnail.'));
    video.addEventListener(event, onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

function make332Palette() {
  const palette = new Uint8Array(256 * 3);
  for (let index = 0; index < 256; index++) {
    const red = (index >> 5) & 7;
    const green = (index >> 2) & 7;
    const blue = index & 3;
    palette[index * 3] = Math.round(red * 255 / 7);
    palette[index * 3 + 1] = Math.round(green * 255 / 7);
    palette[index * 3 + 2] = Math.round(blue * 255 / 3);
  }
  return palette;
}

function mapTo332(rgba: Uint8ClampedArray) {
  const indices = new Uint8Array(rgba.length / 4);
  for (let pixel = 0, channel = 0; pixel < indices.length; pixel++, channel += 4) {
    indices[pixel] = (rgba[channel] & 0xe0) | ((rgba[channel + 1] & 0xe0) >> 3) | (rgba[channel + 2] >> 6);
  }
  return indices;
}

function lzwEncode(indices: Uint8Array) {
  const clearCode = 256;
  const endCode = 257;
  let codeSize = 9;
  let nextCode = 258;
  let bitBuffer = 0;
  let bitCount = 0;
  const bytes: number[] = [];
  const dictionary = new Map<number, number>();
  const emit = (code: number) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      bytes.push(bitBuffer & 255);
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };
  const reset = () => {
    dictionary.clear();
    codeSize = 9;
    nextCode = 258;
  };

  emit(clearCode);
  if (indices.length) {
    let prefix = indices[0];
    for (let index = 1; index < indices.length; index++) {
      const pixel = indices[index];
      const key = prefix * 256 + pixel;
      const match = dictionary.get(key);
      if (match !== undefined) {
        prefix = match;
        continue;
      }
      emit(prefix);
      if (nextCode < 4096) {
        dictionary.set(key, nextCode++);
        if (nextCode === 1 << codeSize && codeSize < 12) codeSize++;
      } else {
        emit(clearCode);
        reset();
      }
      prefix = pixel;
    }
    emit(prefix);
  }
  emit(endCode);
  if (bitCount) bytes.push(bitBuffer & 255);
  return bytes;
}

function pushWord(bytes: number[], value: number) {
  bytes.push(value & 255, (value >> 8) & 255);
}

function appendSubBlocks(bytes: number[], contents: number[]) {
  for (let offset = 0; offset < contents.length; offset += 255) {
    const block = contents.slice(offset, offset + 255);
    bytes.push(block.length, ...block);
  }
  bytes.push(0);
}

function encodeGif(width: number, height: number, frames: Uint8Array[]) {
  const bytes = [71, 73, 70, 56, 57, 97]; // GIF89a
  pushWord(bytes, width);
  pushWord(bytes, height);
  bytes.push(0xf7, 0, 0, ...make332Palette());
  bytes.push(0x21, 0xff, 0x0b, ...[78, 69, 84, 83, 67, 65, 80, 69, 50, 46, 48], 3, 1, 0, 0, 0);

  for (const frame of frames) {
    bytes.push(0x21, 0xf9, 4, 4);
    pushWord(bytes, GIF_FRAME_DELAY);
    bytes.push(0, 0);
    bytes.push(0x2c, 0, 0, 0, 0);
    pushWord(bytes, width);
    pushWord(bytes, height);
    bytes.push(0, 8);
    appendSubBlocks(bytes, lzwEncode(frame));
  }
  bytes.push(0x3b);
  return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
}

async function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read generated thumbnail.'));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read generated thumbnail.'));
    reader.readAsDataURL(blob);
  });
}

/** Creates a compact, looping GIF preview from up to two seconds of a recording. */
export async function makeThumbnail(blob: Blob, atSec = 0.5, width = GIF_WIDTH): Promise<string | null> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await waitForVideo(video, 'loadeddata');
    if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) return null;
    const gifWidth = Math.min(width, video.videoWidth);
    const gifHeight = Math.max(1, Math.round(gifWidth * video.videoHeight / video.videoWidth));
    const canvas = document.createElement('canvas');
    canvas.width = gifWidth;
    canvas.height = gifHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    const availableDuration = Math.max(0, video.duration - 0.08);
    const previewDuration = Math.min(2, availableDuration);
    const previewStart = Math.min(Math.max(0, atSec - 0.4), Math.max(0, availableDuration - previewDuration));
    const frames: Uint8Array[] = [];
    const frameCount = Math.max(1, Math.min(GIF_FRAME_COUNT, Math.floor(previewDuration * 5) + 1));
    for (let index = 0; index < frameCount; index++) {
      const time = frameCount === 1 ? Math.min(0.1, availableDuration) : previewStart + (previewDuration * index) / (frameCount - 1);
      if (Math.abs(video.currentTime - time) > 0.01) {
        const ready = waitForVideo(video, 'seeked');
        video.currentTime = time;
        await ready;
      }
      context.drawImage(video, 0, 0, gifWidth, gifHeight);
      frames.push(mapTo332(context.getImageData(0, 0, gifWidth, gifHeight).data));
    }
    return await blobToDataUrl(encodeGif(gifWidth, gifHeight, frames));
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
