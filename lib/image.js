const sharp = require('sharp');

const MAX_SIZE = 768;
const JPEG_QUALITY = 80;

// rotate()はEXIFのorientationを見て正しい向きに回転させた上でEXIFを破棄する。
// 先にrotate()しないと、EXIF除去後に画像が横向きのまま残ってしまう。
async function resizeForVision(inputBuffer) {
  return sharp(inputBuffer)
    .rotate()
    .resize({
      width: MAX_SIZE,
      height: MAX_SIZE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}

module.exports = { resizeForVision };
