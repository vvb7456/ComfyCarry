/**
 * ComfyUI 工作流元数据提取模块
 *
 * 从 ComfyUI 生成的各种文件类型中提取嵌入的 prompt/workflow 元数据。
 * 全部在客户端完成，不需要服务端参与。
 *
 * 支持格式:
 *   图片: PNG (tEXt) | APNG (comf chunk) | WebP (EXIF) | SVG (CDATA)
 *   视频: WebM (Matroska tags) | MP4 (container metadata)
 *   音频: FLAC (Vorbis Comment) | MP3 (ID3v2 TXXX) | Opus/OGG (Vorbis Comment)
 *   3D:   GLB (glTF asset.extras)
 *   权重: safetensors (.latent 等)
 *
 * @module workflow-metadata
 */

// ── 支持的格式 ─────────────────────────────────────────────

/** 所有支持的文件扩展名 */
export const SUPPORTED_EXTS = new Set([
  '.png', '.webp', '.svg',
  '.webm', '.mp4',
  '.flac', '.mp3', '.opus', '.ogg',
  '.glb',
  '.safetensors', '.latent',
  '.json',
]);

/**
 * 主入口 — 从任意支持的文件中提取 ComfyUI 元数据
 * @param {File} file
 * @returns {Promise<{prompt: object|null, workflow: object|null, format: string}>}
 */
export async function extractComfyUIMetadata(file) {
  const ext = _getExt(file.name);
  const result = { prompt: null, workflow: null, format: ext.replace('.', '') };

  try {
    switch (ext) {
      case '.png':     return await _extractPNG(file, result);
      case '.webp':    return await _extractWebP(file, result);
      case '.svg':     return await _extractSVG(file, result);
      case '.webm':    return await _extractMatroska(file, result);
      case '.mp4':     return await _extractMP4(file, result);
      case '.flac':    return await _extractFLAC(file, result);
      case '.mp3':     return await _extractMP3(file, result);
      case '.opus':
      case '.ogg':     return await _extractOGG(file, result);
      case '.glb':     return await _extractGLB(file, result);
      case '.safetensors':
      case '.latent':  return await _extractSafetensors(file, result);
      case '.json':    return await _extractJSON(file, result);
      default:         return result;
    }
  } catch (_) {
    return result;
  }
}

// ── 工具函数 ─────────────────────────────────────────────

function _getExt(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function _tryParseJSON(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function _readSlice(file, start, end) {
  return file.slice(start, end).arrayBuffer();
}

// ── PNG (tEXt + comf chunk) ─────────────────────────────

async function _extractPNG(file, result) {
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);

  // 验证 PNG 签名
  if (buf.byteLength < 8 || view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) {
    return result;
  }

  const utf8 = new TextDecoder('utf-8');
  let offset = 8;

  while (offset + 12 <= buf.byteLength) {
    const length = view.getUint32(offset);
    const typeBytes = new Uint8Array(buf, offset + 4, 4);
    const type = String.fromCharCode(...typeBytes);

    if (offset + 12 + length > buf.byteLength) break;

    if (type === 'tEXt') {
      // tEXt: keyword\0value
      const data = new Uint8Array(buf, offset + 8, length);
      const nullIdx = data.indexOf(0);
      if (nullIdx > 0) {
        const key = utf8.decode(data.slice(0, nullIdx));
        if (key === 'prompt' || key === 'workflow') {
          const val = utf8.decode(data.slice(nullIdx + 1));
          const parsed = _tryParseJSON(val);
          if (parsed) result[key] = parsed;
        }
      }
    } else if (type === 'zTXt') {
      // zTXt: keyword\0compressionMethod compressedData
      // ComfyUI 不用 zTXt, 但以防万一
      const data = new Uint8Array(buf, offset + 8, length);
      const nullIdx = data.indexOf(0);
      if (nullIdx > 0) {
        const key = utf8.decode(data.slice(0, nullIdx));
        if (key === 'prompt' || key === 'workflow') {
          // compression method 在 null 后 1 byte, 然后是 zlib 数据
          try {
            const compressed = data.slice(nullIdx + 2);
            const decompressed = _inflateRaw(compressed);
            const val = utf8.decode(decompressed);
            const parsed = _tryParseJSON(val);
            if (parsed) result[key] = parsed;
          } catch (_) {}
        }
      }
    } else if (type === 'comf') {
      // APNG 自定义 chunk: key\0value (latin-1 编码)
      const data = new Uint8Array(buf, offset + 8, length);
      const nullIdx = data.indexOf(0);
      if (nullIdx > 0) {
        const latin1 = new TextDecoder('latin1');
        const key = latin1.decode(data.slice(0, nullIdx));
        if (key === 'prompt' || key === 'workflow') {
          const val = latin1.decode(data.slice(nullIdx + 1));
          const parsed = _tryParseJSON(val);
          if (parsed) result[key] = parsed;
        }
      }
    }

    // 不在 IEND 停止, comf chunk 可能在 IEND 之后
    offset += 12 + length; // 4(length) + 4(type) + data + 4(CRC)
  }

  return result;
}

/** 简易 zlib inflate (用于 zTXt), 调用 DecompressionStream API */
async function _inflateRaw(data) {
  if (typeof DecompressionStream === 'undefined') return data;
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  writer.write(data);
  writer.close();
  const reader = ds.readable.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

// ── WebP (EXIF) ─────────────────────────────────────────

async function _extractWebP(file, result) {
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);

  // RIFF header: "RIFF" + size + "WEBP"
  if (buf.byteLength < 12) return result;
  const riffMagic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
  const webpMagic = String.fromCharCode(...new Uint8Array(buf, 8, 4));
  if (riffMagic !== 'RIFF' || webpMagic !== 'WEBP') return result;

  // 扫描 RIFF chunks 找 EXIF
  let offset = 12;
  while (offset + 8 <= buf.byteLength) {
    const chunkId = String.fromCharCode(...new Uint8Array(buf, offset, 4));
    const chunkSize = view.getUint32(offset + 4, true); // LE
    offset += 8;

    if (chunkId === 'EXIF' && offset + chunkSize <= buf.byteLength) {
      _parseExifForComfyUI(new Uint8Array(buf, offset, chunkSize), result);
      break;
    }

    offset += chunkSize + (chunkSize % 2); // RIFF padding to even
  }

  return result;
}

/**
 * 解析 EXIF 数据, 查找 ComfyUI 的 "prompt:..." / "workflow:..." 格式
 * ComfyUI 用 EXIF 0x0110 (Model) 和 0x010F (Make) 等 tag
 */
function _parseExifForComfyUI(exifData, result) {
  // EXIF starts with "Exif\0\0" 或直接 TIFF header ("MM" 或 "II")
  let tiffOffset = 0;
  if (exifData.length >= 6 && exifData[0] === 0x45 && exifData[1] === 0x78) {
    // "Exif\0\0"
    tiffOffset = 6;
  }

  if (tiffOffset + 8 > exifData.length) return;

  const view = new DataView(exifData.buffer, exifData.byteOffset + tiffOffset, exifData.length - tiffOffset);
  const le = view.getUint16(0) === 0x4949; // "II" = little-endian
  const read16 = (o) => view.getUint16(o, le);
  const read32 = (o) => view.getUint32(o, le);

  if (read16(2) !== 0x002A) return; // TIFF magic 42

  let ifdOffset = read32(4);
  const decoder = new TextDecoder('utf-8');

  // 只遍历第一个 IFD (足够找到 ComfyUI tags)
  if (ifdOffset + 2 > view.byteLength) return;
  const numEntries = read16(ifdOffset);
  ifdOffset += 2;

  for (let i = 0; i < numEntries; i++) {
    const entryOff = ifdOffset + i * 12;
    if (entryOff + 12 > view.byteLength) break;

    const tag = read16(entryOff);
    const type = read16(entryOff + 2);
    const count = read32(entryOff + 4);

    // ComfyUI 用 ASCII (type=2) 类型
    if (type !== 2) continue;
    // 只关注 Model (0x0110), Make (0x010F), 以及递减的 tag
    if (tag > 0x0110 || tag < 0x0100) continue;

    let strOff, strLen;
    if (count <= 4) {
      strOff = entryOff + 8;
      strLen = count;
    } else {
      strOff = read32(entryOff + 8);
      strLen = count;
    }

    if (strOff + strLen > view.byteLength) continue;

    const raw = decoder.decode(new Uint8Array(view.buffer, view.byteOffset + strOff, strLen)).replace(/\0+$/, '');
    // ComfyUI 格式: "key:json_value"
    const colonIdx = raw.indexOf(':');
    if (colonIdx <= 0) continue;
    const key = raw.slice(0, colonIdx).trim().toLowerCase();
    if (key === 'prompt' || key === 'workflow') {
      const parsed = _tryParseJSON(raw.slice(colonIdx + 1));
      if (parsed) result[key] = parsed;
    }
  }
}

// ── SVG (CDATA) ─────────────────────────────────────────

async function _extractSVG(file, result) {
  const text = await file.text();
  const match = text.match(/<metadata>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/metadata>/);
  if (match) {
    const meta = _tryParseJSON(match[1]);
    if (meta && typeof meta === 'object') {
      if (meta.prompt) result.prompt = meta.prompt;
      if (meta.workflow) result.workflow = meta.workflow;
    }
  }
  return result;
}

// ── Matroska / WebM (EBML Tags) ─────────────────────────

// EBML 元素 ID
const EBML_TAGS     = [0x12, 0x54, 0xC3, 0x67]; // Tags
const EBML_TAG      = [0x73, 0x73];               // Tag
const EBML_SIMPLE   = [0x67, 0xC8];               // SimpleTag
const EBML_TAGNAME  = [0x45, 0xA3];               // TagName
const EBML_TAGSTR   = [0x44, 0x87];               // TagString

async function _extractMatroska(file, result) {
  // Matroska Tags 通常在文件头的 Segment 中
  // 先读前 1MB, 如果没找到再读后 1MB
  const maxRead = Math.min(file.size, 1024 * 1024);
  let buf = await _readSlice(file, 0, maxRead);
  let data = new Uint8Array(buf);

  _searchMatroskaTags(data, result);

  // 如果前 1MB 没找到, 尝试文件末尾
  if (!result.prompt && !result.workflow && file.size > maxRead) {
    const tailStart = Math.max(0, file.size - 1024 * 1024);
    buf = await _readSlice(file, tailStart, file.size);
    data = new Uint8Array(buf);
    _searchMatroskaTags(data, result);
  }

  return result;
}

function _searchMatroskaTags(data, result) {
  const utf8 = new TextDecoder('utf-8');

  // 扫描 SimpleTag 中的 TagName + TagString 对
  // 策略: 搜索 TagName element ID (0x45A3), 读取值, 然后找紧跟的 TagString (0x4487)
  for (let i = 0; i < data.length - 10; i++) {
    // 查找 TagName element ID: 0x45 0xA3
    if (data[i] !== 0x45 || data[i + 1] !== 0xA3) continue;

    const [nameLen, nameOff] = _readEBMLVint(data, i + 2);
    if (nameLen < 0 || nameOff + nameLen > data.length) continue;

    const tagName = utf8.decode(data.slice(nameOff, nameOff + nameLen));
    if (tagName !== 'prompt' && tagName !== 'workflow') continue;

    // 在 TagName 之后查找 TagString (0x44 0x87)
    const searchStart = nameOff + nameLen;
    const searchEnd = Math.min(searchStart + 1024 * 1024, data.length - 4);
    for (let j = searchStart; j < searchEnd; j++) {
      if (data[j] !== 0x44 || data[j + 1] !== 0x87) continue;

      const [strLen, strOff] = _readEBMLVint(data, j + 2);
      if (strLen < 0 || strOff + strLen > data.length) break;

      const val = utf8.decode(data.slice(strOff, strOff + strLen));
      const parsed = _tryParseJSON(val);
      if (parsed) {
        result[tagName] = parsed;
        i = strOff + strLen; // 跳到 TagString 之后
      }
      break;
    }
  }
}

/** 读取 EBML 可变长度整数 (VINT), 返回 [值, 数据起始偏移] */
function _readEBMLVint(data, pos) {
  if (pos >= data.length) return [-1, pos];
  const first = data[pos];
  if (first === 0) return [-1, pos];

  let width;
  if      (first & 0x80) width = 1;
  else if (first & 0x40) width = 2;
  else if (first & 0x20) width = 3;
  else if (first & 0x10) width = 4;
  else if (first & 0x08) width = 5;
  else if (first & 0x04) width = 6;
  else if (first & 0x02) width = 7;
  else                    width = 8;

  if (pos + width > data.length) return [-1, pos];

  let value = first & ((1 << (8 - width)) - 1);
  for (let i = 1; i < width; i++) {
    value = (value * 256) + data[pos + i]; // 不用 << 避免 32位溢出
  }

  return [value, pos + width];
}

// ── MP4 (container metadata) ─────────────────────────────

async function _extractMP4(file, result) {
  // MP4 metadata 在 moov box 中, 可能在文件头或文件尾
  // 策略: 读取 box 层级找 moov, 然后在 moov 中搜索 metadata

  const headerBuf = await _readSlice(file, 0, Math.min(file.size, 8));
  const headerView = new DataView(headerBuf);
  // 检查 MP4 magic (ftyp box)
  if (headerBuf.byteLength < 8) return result;
  const ftyp = String.fromCharCode(...new Uint8Array(headerBuf, 4, 4));
  if (ftyp !== 'ftyp') return result;

  // 扫描顶层 box 找 moov
  let offset = 0;
  while (offset + 8 <= file.size) {
    const boxHeader = await _readSlice(file, offset, offset + 8);
    const bv = new DataView(boxHeader);
    let boxSize = bv.getUint32(0);
    const boxType = String.fromCharCode(...new Uint8Array(boxHeader, 4, 4));

    if (boxSize === 1 && offset + 16 <= file.size) {
      // extended size (64-bit)
      const extBuf = await _readSlice(file, offset + 8, offset + 16);
      const extView = new DataView(extBuf);
      boxSize = Number(extView.getBigUint64(0));
    }

    if (boxSize < 8) break; // 无效

    if (boxType === 'moov') {
      // 读取整个 moov box
      const moovSize = Math.min(boxSize, 50 * 1024 * 1024); // 限制 50MB
      const moovBuf = await _readSlice(file, offset, offset + moovSize);
      _searchMP4Metadata(new Uint8Array(moovBuf), result);
      break;
    }

    offset += boxSize;
  }

  return result;
}

function _searchMP4Metadata(data, result) {
  const utf8 = new TextDecoder('utf-8');
  // 在 moov 中搜索 "prompt" 和 "workflow" 字符串
  // pyav 使用 movflags=use_metadata_tags, 存储在 udta box 中
  // 方法: 扫描 moov 数据, 寻找 key=value 对
  // MP4 metadata tags 通常以 key-value 对存在, key 紧跟在一些标记字节后
  // 简化方法: 搜索 "prompt" 和 "workflow" 字符串, 提取后面的 JSON

  // 搜索选定的关键字
  for (const key of ['prompt', 'workflow']) {
    const keyBytes = new TextEncoder().encode(key);
    for (let i = 0; i < data.length - keyBytes.length - 10; i++) {
      if (!_bytesMatch(data, i, keyBytes)) continue;

      // 找到了 key, 现在搜索附近的 JSON 值
      // MP4 metadata 格式可能是: 在 key 之后几个字节有 JSON
      // 寻找 key 后面第一个 '{' 开始的合法 JSON
      const searchStart = i + keyBytes.length;
      const searchEnd = Math.min(searchStart + 100, data.length);

      for (let j = searchStart; j < searchEnd; j++) {
        if (data[j] !== 0x7B) continue; // '{'

        // 尝试从这里提取 JSON
        const jsonStr = _extractJSONFromBytes(data, j);
        if (jsonStr) {
          const parsed = _tryParseJSON(jsonStr);
          if (parsed) {
            result[key] = parsed;
            i = data.length; // 跳出外循环
            break;
          }
        }
      }
    }
  }
}

function _bytesMatch(data, offset, pattern) {
  if (offset + pattern.length > data.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    if (data[offset + i] !== pattern[i]) return false;
  }
  return true;
}

function _extractJSONFromBytes(data, start) {
  // 从 '{' 开始, 匹配括号到结束
  let depth = 0;
  let inStr = false;
  let escape = false;

  for (let i = start; i < data.length; i++) {
    const c = data[i];
    if (escape) { escape = false; continue; }
    if (c === 0x5C && inStr) { escape = true; continue; } // backslash
    if (c === 0x22) { inStr = !inStr; continue; } // quote
    if (inStr) continue;
    if (c === 0x7B) depth++; // {
    else if (c === 0x7D) { // }
      depth--;
      if (depth === 0) {
        return new TextDecoder('utf-8').decode(data.slice(start, i + 1));
      }
    }
  }
  return null;
}

// ── FLAC (Vorbis Comment) ────────────────────────────────

async function _extractFLAC(file, result) {
  const headerBuf = await _readSlice(file, 0, Math.min(file.size, 4));
  const headerArr = new Uint8Array(headerBuf);
  // FLAC magic: "fLaC"
  if (headerArr.length < 4 || String.fromCharCode(...headerArr) !== 'fLaC') return result;

  // 遍历 metadata blocks
  let offset = 4;
  while (offset + 4 <= file.size) {
    const blockHeader = new Uint8Array(await _readSlice(file, offset, offset + 4));
    const isLast = (blockHeader[0] & 0x80) !== 0;
    const blockType = blockHeader[0] & 0x7F;
    const blockLength = (blockHeader[1] << 16) | (blockHeader[2] << 8) | blockHeader[3];
    offset += 4;

    if (blockType === 4 && blockLength > 0) {
      // VORBIS_COMMENT block
      const maxRead = Math.min(blockLength, 50 * 1024 * 1024);
      const vcBuf = await _readSlice(file, offset, offset + maxRead);
      _parseVorbisComment(new DataView(vcBuf), 0, result);
      break;
    }

    offset += blockLength;
    if (isLast) break;
  }

  return result;
}

function _parseVorbisComment(view, base, result) {
  const utf8 = new TextDecoder('utf-8');
  let pos = base;

  // Vendor string: length (32 LE) + string
  if (pos + 4 > view.byteLength) return;
  const vendorLen = view.getUint32(pos, true);
  pos += 4 + vendorLen;

  // Comment count
  if (pos + 4 > view.byteLength) return;
  const count = view.getUint32(pos, true);
  pos += 4;

  for (let i = 0; i < count; i++) {
    if (pos + 4 > view.byteLength) break;
    const commentLen = view.getUint32(pos, true);
    pos += 4;
    if (pos + commentLen > view.byteLength) break;

    const comment = utf8.decode(new Uint8Array(view.buffer, view.byteOffset + pos, commentLen));
    pos += commentLen;

    const eqIdx = comment.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = comment.slice(0, eqIdx).toLowerCase();
    if (key === 'prompt' || key === 'workflow') {
      const parsed = _tryParseJSON(comment.slice(eqIdx + 1));
      if (parsed) result[key] = parsed;
    }
  }
}

// ── MP3 (ID3v2 TXXX frames) ──────────────────────────────

async function _extractMP3(file, result) {
  const headerBuf = await _readSlice(file, 0, Math.min(file.size, 10));
  const header = new Uint8Array(headerBuf);

  // ID3v2 header: "ID3" + version (2 bytes) + flags (1) + size (4, syncsafe)
  if (header.length < 10 || header[0] !== 0x49 || header[1] !== 0x44 || header[2] !== 0x33) {
    return result;
  }

  const id3Size = _readSyncsafe(header, 6);
  const id3End = 10 + id3Size;

  // 读取整个 ID3 tag
  const maxRead = Math.min(id3End, file.size, 50 * 1024 * 1024);
  const id3Buf = await _readSlice(file, 10, maxRead);
  const id3Data = new Uint8Array(id3Buf);
  const utf8 = new TextDecoder('utf-8');

  // 遍历 ID3v2 frames
  let pos = 0;
  while (pos + 10 <= id3Data.length) {
    const frameId = String.fromCharCode(id3Data[pos], id3Data[pos+1], id3Data[pos+2], id3Data[pos+3]);
    if (frameId[0] === '\0') break; // padding

    const frameSize = (id3Data[pos+4] << 24) | (id3Data[pos+5] << 16) | (id3Data[pos+6] << 8) | id3Data[pos+7];
    pos += 10; // skip frame header (4 id + 4 size + 2 flags)

    if (frameSize <= 0 || pos + frameSize > id3Data.length) break;

    if (frameId === 'TXXX') {
      // TXXX: encoding (1 byte) + description\0 + value
      const encoding = id3Data[pos];
      const frameData = id3Data.slice(pos + 1, pos + frameSize);

      // 简化: 假设 UTF-8 或 Latin-1
      const nullIdx = frameData.indexOf(0);
      if (nullIdx >= 0) {
        const desc = utf8.decode(frameData.slice(0, nullIdx)).toLowerCase();
        if (desc === 'prompt' || desc === 'workflow') {
          const val = utf8.decode(frameData.slice(nullIdx + 1));
          const parsed = _tryParseJSON(val);
          if (parsed) result[desc] = parsed;
        }
      }
    }

    pos += frameSize;
  }

  return result;
}

function _readSyncsafe(data, offset) {
  return ((data[offset] & 0x7F) << 21) |
         ((data[offset+1] & 0x7F) << 14) |
         ((data[offset+2] & 0x7F) << 7) |
          (data[offset+3] & 0x7F);
}

// ── OGG / Opus (Vorbis Comment) ──────────────────────────

async function _extractOGG(file, result) {
  // OGG page 结构: "OggS" (4) + version (1) + type (1) + ...
  // 第二个 page 通常包含 Vorbis Comment (OpusTags 或 VorbisComment)
  const maxRead = Math.min(file.size, 2 * 1024 * 1024); // 前 2MB 应该够
  const buf = await _readSlice(file, 0, maxRead);
  const data = new Uint8Array(buf);

  let pageCount = 0;
  let pos = 0;

  while (pos + 27 <= data.length && pageCount < 10) {
    // 检查 "OggS" magic
    if (data[pos] !== 0x4F || data[pos+1] !== 0x67 || data[pos+2] !== 0x67 || data[pos+3] !== 0x53) {
      pos++;
      continue;
    }

    const numSegments = data[pos + 26];
    if (pos + 27 + numSegments > data.length) break;

    // 计算 page data 长度
    let pageDataLen = 0;
    for (let s = 0; s < numSegments; s++) {
      pageDataLen += data[pos + 27 + s];
    }

    const pageDataStart = pos + 27 + numSegments;
    pageCount++;

    // 第二个及以后的 page 可能包含 comment
    if (pageCount >= 2 && pageDataStart + pageDataLen <= data.length) {
      const pageData = data.slice(pageDataStart, pageDataStart + pageDataLen);

      // Opus: "OpusTags" 前缀 (8 bytes), 然后 Vorbis Comment
      // Vorbis: "\x03vorbis" 前缀 (7 bytes), 然后 Vorbis Comment
      let vcOffset = 0;
      if (pageData.length > 8 && String.fromCharCode(...pageData.slice(0, 8)) === 'OpusTags') {
        vcOffset = 8;
      } else if (pageData.length > 7 && pageData[0] === 0x03 &&
                 String.fromCharCode(...pageData.slice(1, 7)) === 'vorbis') {
        vcOffset = 7;
      } else {
        pos = pageDataStart + pageDataLen;
        continue;
      }

      const vcView = new DataView(pageData.buffer, pageData.byteOffset + vcOffset, pageData.length - vcOffset);
      _parseVorbisComment(vcView, 0, result);

      if (result.prompt || result.workflow) break;
    }

    pos = pageDataStart + pageDataLen;
  }

  return result;
}

// ── GLB (glTF asset.extras) ──────────────────────────────

async function _extractGLB(file, result) {
  const headerBuf = await _readSlice(file, 0, Math.min(file.size, 12));
  const hv = new DataView(headerBuf);

  // GLB header: magic (4) + version (4) + length (4)
  if (headerBuf.byteLength < 12 || hv.getUint32(0, true) !== 0x46546C67) return result; // "glTF"

  // Chunk 0: JSON
  const chunk0Header = await _readSlice(file, 12, Math.min(file.size, 20));
  const c0v = new DataView(chunk0Header);
  if (chunk0Header.byteLength < 8) return result;
  const chunkLen = c0v.getUint32(0, true);
  const chunkType = c0v.getUint32(4, true);
  if (chunkType !== 0x4E4F534A) return result; // "JSON"

  const maxRead = Math.min(chunkLen, 50 * 1024 * 1024);
  const jsonBuf = await _readSlice(file, 20, 20 + maxRead);
  const jsonStr = new TextDecoder('utf-8').decode(jsonBuf);
  const gltf = _tryParseJSON(jsonStr);

  if (gltf?.asset?.extras) {
    const extras = gltf.asset.extras;
    if (extras.prompt) {
      result.prompt = typeof extras.prompt === 'string' ? _tryParseJSON(extras.prompt) : extras.prompt;
    }
    if (extras.workflow) {
      result.workflow = typeof extras.workflow === 'string' ? _tryParseJSON(extras.workflow) : extras.workflow;
    }
  }

  return result;
}

// ── Safetensors / .latent ────────────────────────────────

async function _extractSafetensors(file, result) {
  // safetensors: 8 bytes header length (uint64 LE) + header JSON
  const lenBuf = await _readSlice(file, 0, Math.min(file.size, 8));
  if (lenBuf.byteLength < 8) return result;

  const lenView = new DataView(lenBuf);
  // 读取 uint64 LE — JS 用 BigInt
  const headerLen = Number(lenView.getBigUint64(0, true));
  if (headerLen <= 0 || headerLen > 100 * 1024 * 1024) return result; // 安全检查

  const maxRead = Math.min(headerLen, file.size - 8);
  const headerBuf = await _readSlice(file, 8, 8 + maxRead);
  const headerStr = new TextDecoder('utf-8').decode(headerBuf);
  const header = _tryParseJSON(headerStr);

  if (!header) return result;

  // safetensors metadata 在 __metadata__ 键下
  const meta = header.__metadata__ || header;

  if (meta.prompt) {
    result.prompt = typeof meta.prompt === 'string' ? _tryParseJSON(meta.prompt) : meta.prompt;
  }
  if (meta.workflow) {
    result.workflow = typeof meta.workflow === 'string' ? _tryParseJSON(meta.workflow) : meta.workflow;
  }

  return result;
}

// ── JSON 文件 ────────────────────────────────────────────

async function _extractJSON(file, result) {
  const text = await file.text();
  const json = _tryParseJSON(text);
  if (!json || typeof json !== 'object') return result;

  // 判断格式: workflow (有 nodes 数组) 或 prompt (对象嵌套 class_type)
  if (json.nodes && Array.isArray(json.nodes)) {
    result.workflow = json;
  } else {
    result.prompt = json;
  }

  return result;
}
