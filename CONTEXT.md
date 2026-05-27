# Sign Avatar Viewer

This context covers the 3D sign-language avatar viewer and the language used to discuss avatar motion quality.

## Language

**Face Expression Rigging**:
The avatar behavior area that turns face keypoints into visible facial expressions.
_Avoid_: face work, expression work

**Morph Expression**:
The part of **Face Expression Rigging** that improves expression through morph target weights rather than head, neck, or body bones.
_Avoid_: head pose, body rigging

**Face Calibration**:
Per-sequence normalization that derives neutral and active face-expression ranges from face keypoints before computing morph weights.
_Avoid_: transition interpolation, word gap smoothing

**Mouth State**:
A semantic mouth-expression category derived from face keypoints before mapping to morph targets.
_Avoid_: direct morph guess, word-specific mouth rule

**Rounded Mouth**:
A **Mouth State** family where the lips are narrow and rounded before being mapped to pucker or funnel morphs.
_Avoid_: open mouth

**Pucker**:
A low-aperture **Rounded Mouth** expression.
_Avoid_: funnel, open mouth

**Funnel**:
A medium-aperture **Rounded Mouth** expression.
_Avoid_: pucker, open mouth

**Open Mouth**:
A **Mouth State** with both lip aperture and jaw or lower-face drop evidence.
_Avoid_: rounded mouth, lip aperture alone

**Pressed Mouth**:
A **Mouth State** where the lips are closed or tense and open or rounded evidence is low.
_Avoid_: neutral mouth, open mouth

**Eye Wide**:
A **Morph Expression** state where eye aperture is wider than calibrated neutral after accounting for head orientation.
_Avoid_: head tilt, gaze direction

**Avatar Renderer**:
The user-facing avatar playback surface that presents sign keypoint sequences as a rigged 3D avatar.
_Avoid_: placeholder player, video player, model file only

**Faithful Motion**:
An avatar motion quality target that prioritizes reproducing source sign keypoints over conservative smoothing.
_Avoid_: safe motion, placeholder motion, naturalized motion

**Avatar Keypoint Payload**:
The sentence-level sign motion data consumed by the **Avatar Renderer**, including body, hand, and face keypoints.
_Avoid_: pose-only frames, hand-only payload, simplified mobile frames

**Web Avatar Renderer**:
The `frontend/web` playback implementation of the **Avatar Renderer**, ported from the latest `3D/viewer` avatar behavior.
_Avoid_: Jetson clone, stale viewer port, video-only result

## Relationships

- **Face Expression Rigging** is the current focus for avatar rigging improvements.
- **Morph Expression** is the current priority within **Face Expression Rigging**.
- **Face Calibration** can improve **Morph Expression** when the source keypoint signals exist but their neutral or active ranges are mis-scaled.
- **Mouth State** is resolved before **Morph Expression** outputs final morph target weights.
- **Pucker** and **Funnel** are both derived from **Rounded Mouth**; aperture decides the final morph emphasis.
- **Open Mouth** requires jaw or lower-face drop evidence in addition to lip aperture.
- **Pressed Mouth** is distinct from neutral mouth because it carries tense or closed-lip expression.
- **Eye Wide** should not be inferred from head roll, head pitch, or gaze direction alone.
- **Face Calibration** is a second-phase improvement after the first **Mouth State** solver is in place.
- **Avatar Renderer** depends on avatar model data, rig aliases, and keypoint-to-rig motion behavior.
- **Faithful Motion** is the preferred target for the mobile **Avatar Renderer**.
- **Avatar Keypoint Payload** preserves face keypoints so **Morph Expression** can be rendered on mobile.
- **Web Avatar Renderer** follows latest `3D/viewer` **Faithful Motion** behavior; `jetson/frontend` is a reference for integration shape only.

## Example dialogue

> **Dev:** "Should this change belong to **Face Expression Rigging** or body motion?"
> **Domain expert:** "This session focuses on **Face Expression Rigging**."
> **Dev:** "Are we improving head movement too?"
> **Domain expert:** "No, prioritize **Morph Expression**."
> **Dev:** "Is **Face Calibration** the same as smoothing between words?"
> **Domain expert:** "No, it normalizes expression ranges before morph weights are computed."
> **Dev:** "Should we map face keypoints straight to morph targets?"
> **Domain expert:** "No, resolve the **Mouth State** first."
> **Dev:** "Should **Pucker** and **Funnel** be detected as unrelated states?"
> **Domain expert:** "No, detect **Rounded Mouth** first, then split by aperture."
> **Dev:** "Is lip separation alone enough for **Open Mouth**?"
> **Domain expert:** "No, require jaw or lower-face drop evidence too."
> **Dev:** "Should a closed tense mouth just be neutral?"
> **Domain expert:** "No, model it as **Pressed Mouth**."
> **Dev:** "Should head tilt make the eyes wide?"
> **Domain expert:** "No, **Eye Wide** requires real eye aperture after head-orientation compensation."
> **Dev:** "Should **Face Calibration** be implemented before **Mouth State**?"
> **Domain expert:** "No, add **Mouth State** first and use **Face Calibration** as a second phase."
> **Dev:** "Can mobile just use the placeholder player once the model file is copied?"
> **Domain expert:** "No, mobile needs the **Avatar Renderer** so the rigged avatar is what users see."
> **Dev:** "Should mobile smooth away difficult arm and shoulder motion?"
> **Domain expert:** "No, mobile should prefer **Faithful Motion** for sign playback."
> **Dev:** "Can mobile simplify the payload to body and hand points?"
> **Domain expert:** "No, the **Avatar Keypoint Payload** should preserve face points for expression."
> **Dev:** "Should the web port copy Jetson behavior exactly?"
> **Domain expert:** "No, the **Web Avatar Renderer** should use latest `3D/viewer` behavior and only use Jetson as an integration reference."

## Flagged ambiguities

- "rigging enhancement" can mean body, hand, head, or face behavior; resolved for this session as **Face Expression Rigging**.
- "face expression" can include head or neck pose; resolved for this session as **Morph Expression**.
- "faceCalibration" was confused with word-gap interpolation; resolved as **Face Calibration**, not transition smoothing.
- "mouth expression" can mean a final morph target or a semantic category; resolved that **Mouth State** is the semantic category before morph mapping.
- "pucker" and "funnel" can be over-separated from noisy 68-point landmarks; resolved as two outputs from the **Rounded Mouth** family.
- "open mouth" was previously inferred from lip separation alone; resolved that **Open Mouth** also requires jaw or lower-face drop evidence.
- "closed mouth" can mean neutral or tense; resolved that tense closed-lip expression is **Pressed Mouth**.
- "eye wide" was confused with head tilt or gaze; resolved that **Eye Wide** requires real aperture after head-orientation compensation.
- "calibration first" would mix normalization with state-solving; resolved that **Face Calibration** follows the first **Mouth State** solver.
- "avatar player" can mean a timing-only placeholder or the rendered 3D surface; resolved as **Avatar Renderer** when the rigged avatar is visible to the user.
- "faithful mode" is an implementation label; resolved in domain language as **Faithful Motion**.
- "mobile frames" previously meant simplified pose and hand arrays; resolved that mobile should consume the full **Avatar Keypoint Payload** when rendering the avatar.
- "web avatar port" can mean copying old `jetson/frontend` behavior; resolved that **Web Avatar Renderer** follows latest `3D/viewer` behavior.
