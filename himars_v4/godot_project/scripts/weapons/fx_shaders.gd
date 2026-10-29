class_name FXShaders
extends RefCounted

## Shader sources of the pooled FX (FXDirector): camera-facing smoke and fire puffs drawn from
## MultiMesh instance data (custom.x = rotation, .y = age 0..1, .z = seed), the shock ring and the
## scorch mark. Smoke is lit by the sun direction only (unshaded, cheap); fire is additive.

const SMOKE_CODE := """shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled;

uniform sampler2D noise_tex : filter_linear_mipmap, repeat_enable;
uniform vec3 sun_dir = vec3(0.0, -1.0, 0.0);
uniform float near_fade = 3.0;

varying vec3 v_sun;
varying vec2 v_seed;
varying float v_age;

void vertex() {
	float s = length(MODEL_MATRIX[0].xyz);
	float a = INSTANCE_CUSTOM.x;
	vec2 xy = vec2(VERTEX.x * cos(a) - VERTEX.y * sin(a), VERTEX.x * sin(a) + VERTEX.y * cos(a));
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	MODELVIEW_NORMAL_MATRIX = mat3(MODELVIEW_MATRIX);
	VERTEX = vec3(xy * s, 0.0);
	v_sun = (VIEW_MATRIX * vec4(-sun_dir, 0.0)).xyz;
	v_seed = vec2(INSTANCE_CUSTOM.z, fract(INSTANCE_CUSTOM.z * 7.31));
	v_age = INSTANCE_CUSTOM.y;
}

void fragment() {
	vec2 uv = UV * 2.0 - 1.0;
	float r = length(uv);
	float n = texture(noise_tex, UV * 0.55 + v_seed + vec2(v_age * 0.08, 0.0)).r;
	float n2 = texture(noise_tex, UV * 1.3 - v_seed * 1.7).r;
	float shape = 1.0 - smoothstep(0.35, 1.0, r + (n - 0.5) * 0.75 + (n2 - 0.5) * 0.25);
	vec3 nrm = normalize(vec3(uv.x, -uv.y, sqrt(max(1.0 - r * r, 0.0)) + 0.35));
	float lit = 0.66 + 0.42 * clamp(dot(nrm, normalize(v_sun)), -0.7, 1.0);
	lit *= mix(0.84, 1.08, n2);
	float fade = smoothstep(0.6, near_fade, -VERTEX.z);
	ALBEDO = COLOR.rgb * lit;
	ALPHA = clamp(COLOR.a * shape * fade, 0.0, 1.0);
}
""";

const GLOW_CODE := """shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, shadows_disabled;

uniform sampler2D noise_tex : filter_linear_mipmap, repeat_enable;
uniform float energy = 2.0;

varying vec2 v_seed;

void vertex() {
	float s = length(MODEL_MATRIX[0].xyz);
	float a = INSTANCE_CUSTOM.x;
	vec2 xy = vec2(VERTEX.x * cos(a) - VERTEX.y * sin(a), VERTEX.x * sin(a) + VERTEX.y * cos(a));
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	MODELVIEW_NORMAL_MATRIX = mat3(MODELVIEW_MATRIX);
	VERTEX = vec3(xy * s, 0.0);
	v_seed = vec2(INSTANCE_CUSTOM.z, fract(INSTANCE_CUSTOM.z * 5.17));
}

void fragment() {
	vec2 uv = UV * 2.0 - 1.0;
	float r = length(uv);
	float n = texture(noise_tex, UV * 0.8 + v_seed).r;
	float core = pow(clamp(1.0 - r - (n - 0.5) * 0.35, 0.0, 1.0), 1.6);
	ALBEDO = COLOR.rgb * energy * (0.75 + 0.5 * n);
	ALPHA = clamp(COLOR.a * core, 0.0, 1.0) * smoothstep(1.0, 8.0, -VERTEX.z);
}
""";

const RING_CODE := """shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled;

uniform sampler2D noise_tex : filter_linear_mipmap, repeat_enable;
uniform float alpha = 0.0;
uniform float width = 0.12;
uniform vec3 tint : source_color = vec3(0.74, 0.68, 0.58);

void fragment() {
	vec2 uv = UV * 2.0 - 1.0;
	float r = length(uv);
	float n = texture(noise_tex, vec2(atan(uv.y, uv.x) * 0.6, r)).r;
	float band = smoothstep(1.0 - width * (0.6 + n), 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
	ALBEDO = tint * (0.85 + 0.3 * n);
	ALPHA = clamp(band * alpha * (0.5 + n), 0.0, 1.0);
}
""";

const SCORCH_CODE := """shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled;

uniform sampler2D noise_tex : filter_linear_mipmap, repeat_enable;
uniform float alpha = 0.0;
uniform vec2 seed = vec2(0.0);

void fragment() {
	vec2 uv = UV * 2.0 - 1.0;
	float r = length(uv);
	float n = texture(noise_tex, UV * 0.9 + seed).r;
	float n2 = texture(noise_tex, UV * 2.7 - seed).r;
	float blot = 1.0 - smoothstep(0.25, 0.95, r + (n - 0.5) * 0.5);
	float rays = smoothstep(0.55, 0.75, n2) * (1.0 - smoothstep(0.6, 1.0, r));
	ALBEDO = mix(vec3(0.035, 0.03, 0.025), vec3(0.12, 0.10, 0.08), n2);
	ALPHA = clamp((blot * 0.92 + rays * 0.35) * alpha, 0.0, 1.0);
}
""";
