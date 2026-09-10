import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
const base = "android/app/src/main/res";
for (const [density, size] of Object.entries({
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
})) {
  const dir = `${base}/mipmap-${density}`;
  await mkdir(dir, { recursive: true });
  const icon = await sharp("assets/icon.svg")
    .resize(size, size)
    .png()
    .toBuffer();
  for (const name of ["ic_launcher.png", "ic_launcher_round.png"])
    await writeFile(`${dir}/${name}`, icon);
}
