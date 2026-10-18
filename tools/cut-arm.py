# Cuts the Ponkeror's arm + bat out of assets/ponkeror-summit.webp (original 2000x1105 render)
# and writes: plate.png (background with the arm removed), arm.png (sprite), arm.json (pivot, reach).
# Usage: python3 tools/cut-arm.py <summit image>   (needs opencv-python-headless, numpy)
import cv2, numpy as np, json, sys
SRC = sys.argv[1]
img = cv2.imread(SRC, cv2.IMREAD_COLOR)  # BGR 2000x1105
H, W = img.shape[:2]

# generous region that can contain bat + hand + forearm (source px)
roi = np.array([(296,0),(412,0),(455,170),(500,300),(560,395),(622,405),(640,470),(636,500),
                (660,522),(664,600),(648,652),(560,662),(528,625),(505,545),(482,470),(470,405),(380,170)], np.int32)
gc = np.full((H, W), cv2.GC_BGD, np.uint8)
cv2.fillPoly(gc, [roi], cv2.GC_PR_FGD)
# sure foreground: bat axis, fist, vambrace core
cv2.line(gc, (353, 0), (532, 330), cv2.GC_FGD, 18)
cv2.line(gc, (532, 330), (560, 470), cv2.GC_FGD, 14)
cv2.ellipse(gc, (555, 470), (40, 40), 0, 0, 360, cv2.GC_FGD, -1)
cv2.ellipse(gc, (595, 525), (22, 14), 20, 0, 360, cv2.GC_FGD, -1)
cv2.fillPoly(gc, [np.array([(560,545),(630,540),(640,600),(600,640),(560,620)], np.int32)], cv2.GC_FGD)
bgm, fgm = np.zeros((1,65),np.float64), np.zeros((1,65),np.float64)
x0,y0,x1,y1 = 250,0,720,700
sub = gc[y0:y1, x0:x1].copy()
cv2.grabCut(img[y0:y1, x0:x1], sub, None, bgm, fgm, 6, cv2.GC_INIT_WITH_MASK)
gc[y0:y1, x0:x1] = sub
mask = np.where((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
gc_mask = mask.copy()
# keep the largest blob, close small holes
n, lab, st, _ = cv2.connectedComponentsWithStats(mask)
mask = np.where(lab == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA]), 255, 0).astype(np.uint8)
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5,5),np.uint8))
# the bat's lit side is close to sky colour, so rebuild the bat rows from a per-row sky model
lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
for y in range(0, 250):
    L = slice(250, 300); R = slice(620, 680)
    xs_s = np.r_[np.arange(250, 300), np.arange(R.start, R.stop)]
    vals = np.r_[lab[y, L], lab[y, R]]
    xr = np.arange(300, 600)
    if True:
        A = np.c_[xs_s, np.ones_like(xs_s)].astype(np.float32)
        coef, *_ = np.linalg.lstsq(A, vals, rcond=None)
        sky = np.c_[xr, np.ones_like(xr)] @ coef
    else:
        sky = np.tile(vals.mean(0), (len(xr), 1))
    d = np.linalg.norm(lab[y, 300:600] - sky, axis=1)
    hit = np.where(d > 9)[0]
    if len(hit):
        # the bat is one solid run per row: take the run that contains the axis
        ax = int(353 + (532 - 353) * y / 330) - 300
        runs = np.split(hit, np.where(np.diff(hit) > 3)[0] + 1)
        run = min(runs, key=lambda r: 0 if r[0] <= ax <= r[-1] else min(abs(r[0]-ax), abs(r[-1]-ax)))
        hw = int(50 - 22 * y / 330)  # the bat tapers toward the grip
        lo, hi = max(run[0], ax - hw), min(run[-1], ax + hw)
        if lo <= hi: mask[y, 300 + lo: 300 + hi + 1] = 255
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7,7),np.uint8))
n, lab2, st, _ = cv2.connectedComponentsWithStats(mask)
mask = np.where(lab2 == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA]), 255, 0).astype(np.uint8)
# fill each row solid between its outer edges (bat and fist have no holes)
for y in range(0, 520):
    ax = int(353 + (532 - 353) * min(y, 330) / 330)
    lo = 280 if y >= 330 else max(280, ax - 62)
    hi = 640 if y >= 330 else min(640, ax + 62)
    mask[y, 280:lo] = 0 if y < 330 else mask[y, 280:lo]
    mask[y, hi:640] = 0 if y < 330 else mask[y, hi:640]
    xs_ = np.where(mask[y, lo:hi] > 0)[0]
    if len(xs_): mask[y, lo + xs_[0]: lo + xs_[-1] + 1] = 255
# below the barrel the bat only gets thinner: clamp each side to the barrel's edge lines
ys_fit = np.arange(120, 245)
re = np.array([280 + np.where(mask[y, 280:640] > 0)[0][-1] for y in ys_fit])
le = np.array([280 + np.where(mask[y, 280:640] > 0)[0][0] for y in ys_fit])
pr, pl = np.polyfit(ys_fit, re, 1), np.polyfit(ys_fit, le, 1)
for y in range(245, 400):
    mask[y, int(np.polyval(pr, y)) + 2:640] = 0 if y < 405 else mask[y, int(np.polyval(pr, y)) + 2:640]
    mask[y, 280:max(280, int(np.polyval(pl, y)) - 2)] = 0
# taper and grip: re-detect against the sky colour sampled just left of the bat on the same row
for y in range(245, 415):
    l, r = max(280, int(np.polyval(pl, y)) - 2), int(np.polyval(pr, y)) + 2
    skyc = lab[y, l - 45:l - 5].mean(0)
    d = np.linalg.norm(lab[y, l:r] - skyc, axis=1)
    hit = np.where((d > 13) | (lab[y, l:r, 0] < 110))[0]
    mask[y, l:r] = 0
    if len(hit):
        runs = np.split(hit, np.where(np.diff(hit) > 2)[0] + 1)
        run = max(runs, key=len)
        mask[y, l + run[0]: l + run[-1] + 1] = 255
# give the fist back (it is wider than the handle)
fist = np.zeros_like(mask)
cv2.fillPoly(fist, [roi], 255)
fist[:415] = 0
mask = np.where((fist > 0) & (gc_mask > 0), 255, mask)
cv2.imwrite('mask.png', mask)

# clean plate: inpaint where the arm was (slightly dilated)
hole = cv2.dilate(mask, np.ones((15,15),np.uint8))
plate = cv2.inpaint(img, hole, 7, cv2.INPAINT_TELEA)
# the sky behind the bat is smooth left to right: fill those rows by interpolating across the gap
for y in range(0, 400):
    xs_ = np.where(hole[y] > 0)[0]
    if not len(xs_): continue
    a0, a1 = xs_[0] - 1, xs_[-1] + 1
    ca = img[y, a0 - 3:a0 + 1].mean(0); cb = img[y, a1:a1 + 4].mean(0)
    t = np.linspace(0, 1, a1 - a0 + 1)[:, None]
    plate[y, a0:a1 + 1] = (ca * (1 - t) + cb * t).astype(np.uint8)
# blend the seam between the two fills
plate[380:420] = cv2.GaussianBlur(plate[370:430], (1, 9), 0)[10:50]
cv2.imwrite('plate.png', plate)

# sprite: soft alpha edge
alpha = cv2.GaussianBlur(mask, (0,0), 0.9)
PAD = 90  # room above the frame for the bat's missing end
cx0, cy0, cx1, cy1 = 280, -PAD, 700, 680
spr = np.zeros((cy1-cy0, cx1-cx0, 4), np.uint8)
spr[PAD:, :, :3] = img[0:cy1, cx0:cx1]
spr[PAD:, :, 3] = alpha[0:cy1, cx0:cx1]

# finish the bat: it is cut by the top of the frame. Extend it along its axis and round the end.
ys = [r for r in range(0, 12)]
cxs = [np.mean(np.where(mask[r, 280:700] > 0)[0]) + 280 for r in ys]
c_top = np.array([np.mean(cxs), 5.5])
r2 = 200
c_low = np.array([np.mean(np.where(mask[r2, 280:700] > 0)[0]) + 280, r2])
axis = (c_top - c_low) / np.linalg.norm(c_top - c_low)   # points up the bat
row = img[0, :, :]; mrow = mask[0, :]
xs = np.where(mrow[280:700] > 0)[0] + 280
halfw = (xs.max() - xs.min()) / 2 * abs(axis[1])  # true half-width across the bat
EXT = 46
for k in range(1, EXT + 1):
    for x in range(xs.min() - 2, xs.max() + 3):
        if mrow[x] == 0: continue
        px = x + axis[0] * k / abs(axis[1]) * abs(axis[1]); py = -k
        px = x + axis[0] / -axis[1] * k  # move along axis so that y decreases by k
        ix, iy = int(round(px)) - cx0, int(round(py)) - cy0
        if 0 <= ix < spr.shape[1] and 0 <= iy < spr.shape[0]:
            spr[iy, ix, :3] = row[x]; spr[iy, ix, 3] = 255
# fill pinholes from the skewed copy, then round the end with an ellipse cap
a = spr[:, :, 3].copy()
top = np.zeros_like(a); top[:PAD + 1] = a[:PAD + 1]
closed = cv2.morphologyEx(top, cv2.MORPH_CLOSE, np.ones((3,3),np.uint8))
for c in range(3):
    ch = spr[:, :, c]; blur = cv2.medianBlur(ch, 3)
    hole_px = (closed > 0) & (top == 0)
    ch[hole_px] = blur[hole_px]
spr[:PAD + 1, :, 3] = closed[:PAD + 1]
end = c_top + axis * (EXT / abs(axis[1]))     # end of the extension along the axis (source px)
capc = end - axis * halfw * 0.9
ang = np.degrees(np.arctan2(axis[1], axis[0]))
cap = np.zeros_like(a)
cv2.ellipse(cap, (int(capc[0]-cx0), int(capc[1]-cy0)), (int(halfw*1.0), int(halfw*1.0)), ang, 0, 360, 255, -1)
# everything beyond the cap center along the axis must be inside the cap
yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
proj = (xx + cx0 - capc[0]) * axis[0] + (yy + cy0 - capc[1]) * axis[1]
beyond = proj > 0
al = spr[:, :, 3]
al[beyond & (cap == 0)] = 0
spr[:, :, 3] = cv2.GaussianBlur(al, (0,0), 0.7) if True else al
cv2.imwrite('arm.png', spr)

pivot = (600, 628)
tip = end
reach = float(np.hypot(tip[0]-pivot[0], tip[1]-pivot[1]))
angle = float(np.degrees(np.arctan2(tip[1]-pivot[1], tip[0]-pivot[0])))
json.dump({'sprite_origin': [cx0, cy0], 'sprite_size': [spr.shape[1], spr.shape[0]], 'pivot': pivot,
           'tip': [float(tip[0]), float(tip[1])], 'reach': reach, 'tip_angle': angle}, open('arm.json','w'), indent=1)
print(json.load(open('arm.json')))
