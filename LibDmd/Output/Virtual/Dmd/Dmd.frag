

in vec2 dmdUv;
in vec2 glassUv;

uniform sampler2D dmdTexture; // Base DMD
uniform sampler2D dmdDotGlow; // DMD Small blur
uniform sampler2D dmdBackGlow; // DMD Large blur
uniform sampler2D glassTexture; // Glass texture

uniform vec2 dmdSize; // DMD size
uniform vec3 unlitDot; // Color of unlit dots
uniform vec4 glassColor; // Glass color: RGB components are used to tint the glass, the A component is the amount of light from the DMD that the glass reflects

out vec4 FragColor;

// from http://www.iquilezles.org/www/articles/distfunctions/distfunctions.htm
float udRoundBox(vec2 p, float b, float r)
{
	vec2 q = abs(p) - b + r;
	return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; // SDF with negative values inside the dot
    // return length(max(q, 0.0)) - r; // SDF with 0 distance inside the dot
}

#ifdef SCANLINES
// Coverage of the scanline beam at the current fragment, for a dot of the given luminance
float scanlineMask(float lum)
{
	float line = dmdUv.y * dmdSize.y * scanlinesPerDot;
	// 0.0 at the center of a scanline, 1.0 at its border
	float dist = abs(fract(line) - 0.5) * 2.0;
	// anti-aliasing over about one screen pixel, so thin lines don't flicker when the DMD is small
	float aa = fwidth(line);
	// beam height grows with luminance: thin lines for dim dots, solid for full brightness
	float beam = mix(0.4, 1.0 + aa, lum * lum);
	float mask = 1.0 - smoothstep(beam - aa, beam + aa, dist);
	return mix(1.0, mask, scanlines);
}
#endif

#ifdef SMOOTH_EDGES
// Color of the dot at the given cell. Outside of the DMD is unlit, so shapes touching the
// border get their corners cut like everywhere else.
vec3 dmdAt(vec2 cell)
{
	if (any(lessThan(cell, vec2(0.0))) || any(greaterThanEqual(cell, dmdSize))) {
		return vec3(0.0);
	}
	return texture(dmdTexture, (cell + 0.5) / dmdSize).rgb;
}

// Color distance in YUV, luma weighs more than chroma (same weights as FrameUtil.ScaleXbr)
float df(vec3 a, vec3 b)
{
	vec3 d = a - b;
	return 48.0 * abs(dot(d, vec3(0.299, 0.587, 0.114)))
		+ 7.0 * abs(dot(d, vec3(-0.169, -0.331, 0.5)))
		+ 6.0 * abs(dot(d, vec3(0.5, -0.419, -0.081)));
}

bool same(vec3 a, vec3 b)
{
	return df(a, b) < 2.0;
}

// Anti-aliased coverage of the half-plane 'value > edge', where 'slope' is the length of the
// gradient of 'value' in dot units and 'px' the size of a screen pixel in dot units.
float cover(float value, float edge, float slope, float px)
{
	float w = 0.5 * slope * px;
	return smoothstep(edge - w, edge + w, value);
}

// Edge smoothing for the corner of the current dot in direction 'dir', using the xBR lv2 edge
// detection (Hyllian). Returns the color to blend in and how much of it covers the fragment.
// The neighborhood is named as if the corner were the bottom-right one:
//      B  C
//   D  E  F  F4
//   G  H  I  I4
//      H5 I5
vec4 smoothCorner(vec2 cell, vec2 fp, vec2 dir, vec3 e, float px)
{
	vec2 dx = vec2(dir.x, 0.0);
	vec2 dy = vec2(0.0, dir.y);
	vec3 b = dmdAt(cell - dy);
	vec3 c = dmdAt(cell + dx - dy);
	vec3 d = dmdAt(cell - dx);
	vec3 f = dmdAt(cell + dx);
	vec3 g = dmdAt(cell - dx + dy);
	vec3 h = dmdAt(cell + dy);
	vec3 i = dmdAt(cell + dx + dy);
	vec3 f4 = dmdAt(cell + 2.0 * dx);
	vec3 i4 = dmdAt(cell + 2.0 * dx + dy);
	vec3 h5 = dmdAt(cell + 2.0 * dy);
	vec3 i5 = dmdAt(cell + dx + 2.0 * dy);

	// weight of an edge running through the corner (along F-H) vs. across it (along E-I)
	float along = df(e, c) + df(e, g) + df(i, h5) + df(i, f4) + 4.0 * df(h, f);
	float across = df(h, d) + df(h, i5) + df(f, i4) + df(f, b) + 4.0 * df(e, i);
	bool edge45 = along < across && !same(e, f) && !same(e, h);

	// the end of a stroke that is a single dot thick: it continues away from the corner and stops
	// towards it, also diagonally (otherwise it's a curve turning, which needs the full cut).
	// cutting half a dot on both sides of an end would make it pointy, so only round it off a little.
	bool verticalEnd = same(d, f) && same(e, b) && !same(e, g) && !same(e, i);
	bool horizontalEnd = same(b, h) && same(e, d) && !same(e, c) && !same(e, i);
	bool strokeEnd = verticalEnd || horizontalEnd;

	// shallow edge continuing to G (2 dots wide, 1 high) and steep edge continuing to C
	bool edgeShallow = edge45 && !strokeEnd && 2.0 * df(f, g) <= df(h, c) && !same(e, g) && !same(d, g);
	bool edgeSteep = edge45 && !strokeEnd && df(f, g) >= 2.0 * df(h, c) && !same(e, c) && !same(b, c);

	// position in the dot, 0.0 at the side away from the corner, 1.0 at the side facing it
	vec2 l = mix(1.0 - fp, fp, step(0.0, dir));
	float cut45 = cover(l.x + l.y, strokeEnd ? 1.75 : 1.5, 1.414, px);
	float cutShallow = cover(l.y + 0.5 * l.x, 1.0, 1.118, px);
	float cutSteep = cover(l.x + 0.5 * l.y, 1.0, 1.118, px);

	float amount = max(edge45 ? cut45 : 0.0, max(edgeShallow ? cutShallow : 0.0, edgeSteep ? cutSteep : 0.0));
	return vec4(df(e, f) <= df(e, h) ? f : h, amount);
}

// Solid dot color with edges smoothed along straight lines (45°, and 2:1 / 1:2 slopes). Contrary
// to the CPU scaler, the lines are drawn at screen resolution, so they stay straight at any size.
vec3 smoothDotColor()
{
	vec2 pos = dmdUv * dmdSize;
	vec2 cell = floor(pos);
	vec2 fp = pos - cell;
	float px = max(fwidth(pos.x), fwidth(pos.y));
	vec3 e = dmdAt(cell);

	// shallow and steep cuts reach beyond the quadrant, so check all four corners and keep the
	// one covering the fragment most
	vec4 best = smoothCorner(cell, fp, vec2(1.0, 1.0), e, px);
	vec4 corner = smoothCorner(cell, fp, vec2(-1.0, 1.0), e, px);
	if (corner.a > best.a) best = corner;
	corner = smoothCorner(cell, fp, vec2(1.0, -1.0), e, px);
	if (corner.a > best.a) best = corner;
	corner = smoothCorner(cell, fp, vec2(-1.0, -1.0), e, px);
	if (corner.a > best.a) best = corner;
	return mix(e, best.rgb, best.a);
}
#endif

// Compute the dot color contribution from dot placed at 'ofs' to the current fragment
vec3 computeDotColor(vec2 ofs)
{
	// Nearest filtering for base dots
	vec2 nearest = (floor(dmdUv * dmdSize) + ofs) / dmdSize;
	// Sampling position as (0,0) at dot center, (-1,-1) to (1,1) in dot corners
	vec2 pos = 2.0 * (fract(dmdUv * dmdSize) - ofs);
	// Dots from the lamp
	float dot = smoothstep(sharpMax, sharpMin, udRoundBox(pos, dotSize, dotRounding * dotSize));
	vec3 dmd = texture(dmdTexture, nearest).rgb;
#ifdef SCANLINES
	dot *= scanlineMask(max(dmd.r, max(dmd.g, dmd.b)));
#endif
#ifdef UNLIT
	// Add a little shadow for unlit dots which are lightly visible on real DMDs
	dmd += unlitDot;
#endif
	return dmd * dot;
}

void main()
{
	vec3 dotColor;

#ifdef SMOOTH_EDGES
	// Solid pixels with smoothed edges, dot size and rounding don't apply
	dotColor = smoothDotColor();
#ifdef SCANLINES
	dotColor *= scanlineMask(max(dotColor.r, max(dotColor.g, dotColor.b)));
#endif
#ifdef UNLIT
	dotColor += unlitDot;
#endif
#elif defined(DOT_OVERLAP)
	// Base dot color, taken in account the 9 nearest surrounding dots
	dotColor = vec3(0.0);
	for(int x = -1; x <= 1; x++) {
		for(int y = -1; y <= 1; y++) {
			dotColor = max(dotColor, computeDotColor(vec2(float(x) + 0.5, float(y) + 0.5)));
		}
	}
#else
	// Base dot color, taken in account only the nearest dot
	dotColor = computeDotColor(vec2(0.5, 0.5));
#endif

#ifdef DOTGLOW
	// glow from nearby lamps (taken from light DMD blur)
	dotColor += texture(dmdDotGlow, dmdUv).rgb * dotGlow;
#endif

#ifdef BACKGLOW
	// add background diffuse light (very blurry from large DMD blur)
	dotColor += texture(dmdBackGlow, dmdUv).rgb * backGlow;
#endif

#ifdef BRIGHTNESS
	// Apply the overall brightness
	dotColor *= brightness;
#endif

#ifdef GLASS
	// Apply the glass as a tinted (lighten by the DMD using large blur, and the base color) additive blend.
	vec4 glass = texture(glassTexture, glassUv);
	vec3 glassLight = glassColor.rgb + 2.5 * glassColor.a * texture(dmdBackGlow, dmdUv).rgb * brightness;
	dotColor += glass.rgb * glassLight.rgb;
#endif

#ifdef GAMMA
	// Gamma correction 
	dotColor = pow(dotColor, vec3(1.0 / gamma));
#endif

    FragColor = vec4(dotColor, 1.0);
}