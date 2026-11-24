# LWACNet — Crowd Intelligence | Professional UI Release

LWACNet is a Vercel-ready static web application with a serverless API gateway for crowd intelligence and people counting. This release improves the frontend interface while preserving the existing FastAPI and PyTorch backend, including the trained model and its checkpoint.

## Key Updates & Improvements

- **Homepage Refinement:** Improved the sizing and alignment of the person-detection reference image with the main headline while preserving the original image asset and color scheme.
- **Simplified Results Interface:** Removed Inference Time, Model Throughput, and Crowd Threshold cards. Results now feature a single primary **Estimated People** card with rounded whole-number counts.
- **Streamlined UI:** Removed the editable crowd threshold slider, original-image density overlay, opacity toggle, and optional validation section. The actual predicted density heatmap remains available.
- **Visual Enhancements:** Added subtle entrance animations, icon effects, card hover interactions, and improved responsive layouts for desktop and mobile devices.
- **Preserved Functionality:** Retained image uploads, camera capture, image-condition testing, MP4/WebM frame sampling, prediction cancellation, frame-by-frame count timelines, density heatmaps, and PNG/JSON/CSV exports.
- **Backend Compatibility:** No changes were made to `/api/health`, `/api/predict`, Vercel configuration, model loading, prediction logic, or API request formats.

**Important:** The backend continues to generate fractional crowd-count predictions. Rounding is applied only to the frontend display. Original numerical values remain unchanged in API responses, frame records, and exported data.

## Deployment Guide (Vercel)

1. **Open Your Existing Project:** Use the same Vercel project that is already configured and working.
2. **Upload the ZIP:** Navigate to the project's Overview → Drop to Deploy section, if supported, or use your existing deployment workflow. The ZIP contains `index.html` at its root.
3. **Configure Framework:** Select `Other` as the framework preset and leave the build command empty.
4. **Backend Connection:** Keep the local FastAPI service running at `http://127.0.0.1:8000` and maintain an active ngrok tunnel forwarding traffic to port 8000.
5. **Set Environment Variable:** In Vercel → Environment Variables, configure:

   `LWACNET_BACKEND_URL`

   Set its value to your current public HTTPS ngrok backend URL without a trailing `/health`.

   Existing fallback URL:

   `https://elliptic-scarcity-hexagram.ngrok-free.dev`

   If this variable already exists in your Vercel project, update it only when the ngrok URL changes. Do not create duplicate variables.
6. **Verify Deployment:** Check the public ngrok `/health` endpoint and the Vercel `/api/health` endpoint. Both should return `"status":"ready"`.
7. **Test Predictions:** Open the Analysis Studio and verify image-based and MP4 frame-based predictions.

## Project Structure

```text
LWACNet/
│
├── index.html
├── styles.css
├── app.js
├── assets/
│
└── api/
    └── Serverless API functions
```

## Technical Scope & Limitations

- **Real Predictions:** The deployed application uses actual model predictions. There is no fake-model fallback.
- **Detection Visualization:** The homepage hero image is a separate reference illustration containing detection boxes. LWACNet itself does not generate person bounding boxes.
- **Density Heatmap:** The displayed predicted density heatmap is generated using LWACNet's actual density prediction.
- **Video Processing:** MP4 videos are decoded in the browser, which extracts and sends sampled JPEG frames for image-based inference (up to 24 frames). This is not identity tracking or full-frame-rate video inference.
- **Backend Availability:** The free local laptop/ngrok setup works only while the FastAPI server and ngrok tunnel remain active.
- **Security:** The backend gateway should be properly secured and rate-limited before wider public access.

## Testing & Verification

This release was locally checked using automated browser-simulated API responses and a gateway forwarding test.

**Deployment Status:** The application has not been deployed to or live-tested against the Vercel account from this development environment.

---

**LWACNet — Crowd Intelligence**

*Professional interface. Real-time crowd analysis. Preserved model integrity.*
