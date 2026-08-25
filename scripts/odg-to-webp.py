# -*- coding: utf-8 -*-
"""起動画面の画像を assets/*.odg(LibreOffice Draw)から public/icons/*.webp に変換する。

使い方:
    python scripts/odg-to-webp.py assets/Startup-20260825.odg 1024

    第2引数は「作品の幅」[px](既定 1024)。実機は 900〜1030 デバイスpx で描画するため、
    1024 あれば拡大されない(端末ごとの実測は docs/deployGuide-202608.md の 5.3 を参照)。
    出力名は解像度から決まる(例: Startup-1024x1836.webp)。

なぜ単純な --convert-to では駄目か:
    LibreOffice の書き出しは「ページ全体」を指定ピクセル数に押し込む。Draw の用紙は
    A4 のままで作品はその一部に置かれているため、素直に幅・高さを指定すると
      - ページの縦横比(A4 = 0.707)と指定値の比が違えば画像が横に潰れる
      - 作品の周りに用紙の余白が白帯として入る
    という2つの壊れ方をする。そこで
      1) .odg(実体は zip)から 用紙寸法 と 作品の外接矩形 を読む
      2) 作品が目標幅になるページ全体のピクセル数を逆算して書き出す(縦横比は保つ)
      3) 外接矩形どおりに切り抜く
    という順で処理する。白地の自動検出には頼らない(イラスト上部の空が白いため、
    白検出だと上端が切れる)。

透過について:
    現行の素材は全画素が不透明なので RGB(アルファ無し)で保存している。
    透過が要る画像に差し替えるときは RGB への変換を外すこと。
"""
import os
import re
import subprocess
import sys
import tempfile
import zipfile

from PIL import Image

SOFFICE = os.environ.get('SOFFICE', r'C:\Program Files\LibreOffice\program\soffice.com')
# 単位付きの長さ(ODF は cm/mm/inch などで持つ)を cm に揃える
UNITS = {'cm': 1.0, 'mm': 0.1, 'in': 2.54, 'pt': 2.54 / 72, 'pc': 2.54 / 6}
# これより暗い画素は「描画あり」とみなす(用紙の地色 #ffffff と区別する)
INK_MAX = 244


def to_cm(value):
    m = re.match(r'^(-?[\d.]+)\s*([a-z]+)$', value.strip())
    if not m:
        raise ValueError('長さを解釈できません: %r' % value)
    return float(m.group(1)) * UNITS[m.group(2)]


def geometry(odg):
    """(用紙幅, 用紙高さ, 作品の外接矩形) を cm で返す。"""
    z = zipfile.ZipFile(odg)
    page = None
    styles = z.read('styles.xml').decode('utf-8', 'replace')
    for m in re.finditer(r'<style:page-layout-properties[^>]*>', styles):
        g = dict(re.findall(r'fo:(page-width|page-height)="([^"]+)"', m.group(0)))
        if g:
            page = (to_cm(g['page-width']), to_cm(g['page-height']))
            break
    if page is None:
        raise SystemExit('用紙サイズを読み取れませんでした: %s' % odg)

    content = z.read('content.xml').decode('utf-8', 'replace')
    box = None
    shapes = r'<draw:(?:frame|custom-shape|text-box|g|rect|polygon|path|line|ellipse)\b[^>]*>'
    for m in re.finditer(shapes, content):
        g = dict(re.findall(r'svg:(x|y|width|height)="([^"]+)"', m.group(0)))
        if len(g) < 4:
            continue
        x, y = to_cm(g['x']), to_cm(g['y'])
        r, b = x + to_cm(g['width']), y + to_cm(g['height'])
        box = (x, y, r, b) if box is None else (
            min(box[0], x), min(box[1], y), max(box[2], r), max(box[3], b))
    if box is None:
        raise SystemExit('作品の位置を読み取れませんでした: %s' % odg)
    return page[0], page[1], box


def export_page(odg, px_w, px_h, workdir):
    """用紙全体を指定ピクセル数の PNG に書き出して開く。"""
    opts = ('{"PixelWidth":{"type":"long","value":%d},'
            '"PixelHeight":{"type":"long","value":%d}}' % (px_w, px_h))
    profile = 'file:///' + os.path.join(workdir, 'lo-profile').replace('\\', '/')
    subprocess.run(
        [SOFFICE, '-env:UserInstallation=' + profile, '--headless',
         '--convert-to', 'png:draw_png_Export:' + opts, '--outdir', workdir, odg],
        check=True, capture_output=True)
    png = os.path.join(workdir, os.path.splitext(os.path.basename(odg))[0] + '.png')
    return Image.open(png).convert('RGB')


def has_ink_outside(im, box):
    """切り抜き枠のすぐ外側に描画がはみ出している辺の名前を返す。

    文字は図形の枠を越えて描かれることがあり、content.xml の svg:width/height だけでは
    実際の描画範囲に足りないことがある(下端の欧文が切れる)。
    """
    w, h = im.size
    px = im.load()
    row = lambda y: any(min(px[x, y]) <= INK_MAX for x in range(max(0, box[0]), min(w, box[2])))
    col = lambda x: any(min(px[x, y]) <= INK_MAX for y in range(max(0, box[1]), min(h, box[3])))
    over = []
    if box[1] > 0 and row(box[1] - 1): over.append('上')
    if box[3] < h and row(box[3]):     over.append('下')
    if box[0] > 0 and col(box[0] - 1): over.append('左')
    if box[2] < w and col(box[2]):     over.append('右')
    return over


def grow_to_paper(im, box):
    """はみ出しがある辺を、用紙の地色に届くまで広げる。"""
    w, h = im.size
    px = im.load()
    blank_row = lambda y: all(min(px[x, y]) > INK_MAX for x in range(max(0, box[0]), min(w, box[2])))
    blank_col = lambda x: all(min(px[x, y]) > INK_MAX for y in range(max(0, box[1]), min(h, box[3])))
    while box[1] > 0 and not blank_row(box[1] - 1): box[1] -= 1
    while box[3] < h and not blank_row(box[3]):     box[3] += 1
    while box[0] > 0 and not blank_col(box[0] - 1): box[0] -= 1
    while box[2] < w and not blank_col(box[2]):     box[2] += 1
    return box


def convert(odg, target_w, outdir, quality=90, grow=False):
    pw, ph, (x0, y0, x1, y1) = geometry(odg)
    art_w = x1 - x0

    # 切り抜き後の幅がちょうど target_w になる用紙ピクセル幅を選ぶ
    # (端の丸めで 1px ずれることがあるため、近傍から合うものを取る)
    base = round(pw * target_w / art_w)
    crop_w = lambda n: round(x1 * n / pw) - round(x0 * n / pw)
    page_px_w = min(range(base - 4, base + 5),
                    key=lambda n: (abs(crop_w(n) - target_w), abs(n - base)))
    page_px_h = round(page_px_w * ph / pw)   # 用紙の縦横比を保つ = 歪ませない

    with tempfile.TemporaryDirectory() as workdir:
        full = export_page(odg, page_px_w, page_px_h, workdir)
        sx, sy = full.size[0] / pw, full.size[1] / ph
        box = [round(x0 * sx), round(y0 * sy), round(x1 * sx), round(y1 * sy)]
        over = has_ink_outside(full, box)
        if over and grow:
            box = grow_to_paper(full, box)
            print('はみ出し: %s 側 → 用紙の地色まで広げました' % '/'.join(over))
        elif over:
            print('⚠ はみ出し: %s 側に描画があります。切れます。'
                  '含めるなら --grow を付けてください' % '/'.join(over))
        else:
            print('はみ出し: なし')
        art = full.crop(tuple(box))

    os.makedirs(outdir, exist_ok=True)
    name = 'Startup-%dx%d.webp' % art.size
    out = os.path.join(outdir, name)
    art.save(out, 'WEBP', quality=quality, method=6)
    print('用紙    : %.3f x %.3f cm → %d x %d px' % (pw, ph, page_px_w, page_px_h))
    print('作品    : x %.3f-%.3f cm / y %.3f-%.3f cm' % (x0, x1, y0, y1))
    print('書き出し: %s  %d x %d  %d bytes' % (out, art.size[0], art.size[1], os.path.getsize(out)))
    return out


def main(argv):
    args = [a for a in argv[1:] if not a.startswith('--')]
    if not args:
        raise SystemExit(__doc__)
    convert(
        odg=args[0],
        target_w=int(args[1]) if len(args) > 1 else 1024,
        outdir=args[2] if len(args) > 2 else os.path.join('public', 'icons'),
        grow='--grow' in argv,
    )


if __name__ == '__main__':
    main(sys.argv)
