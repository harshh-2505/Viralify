# How Viralify evaluates content

Viralify helps creators find useful edits and run publishing experiments. It does not determine whether a post will go viral. The displayed score is a product-defined readiness measure derived from a fixed rubric and the evidence available in the submitted content.

There is no training set of viral posts, fitted reach model, probability calibration, live trend crawler, follower graph, or platform analytics connection in this version. No expected-view count or guaranteed reach uplift is inferred from the score. A high score means the content satisfies more of the implemented checks; it cannot establish audience demand or future distribution.

## Evidence used

For media without a caption or transcript, only media readiness contributes to the score. Other dimensions have zero weight and display “Not assessed.” This avoids treating absent evidence as poor content. The technical-only result cannot be compared directly with a full content assessment.

The system combines the submitted text or caption, selected content type and platform, stated audience and objective, and measurements from a server-decoded upload. Client-supplied metadata is not accepted as evidence of a file's dimensions, duration, or contents.

| Content | Measured evidence                                                                            | What the evidence does not establish                                                                         |
| ------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Text    | Wording, opening structure, length, readability signals, specificity, and engagement prompts | Truth, originality, actual reader response, or real trend relevance                                          |
| Image   | Dimensions, aspect ratio, grayscale brightness and contrast                                  | Subject, composition quality, meaning, or accessibility of embedded text in local mode                       |
| Audio   | Duration, sample peak, and detected silence in up to the first 120 seconds                   | Speech meaning without transcription, music quality, full-recording loudness, or measured audience retention |
| Video   | Duration, dimensions, opening-frame brightness and contrast, available audio measurements    | Complete editing quality, narrative comprehension, retention, or every frame's visual quality                |

Sharp decodes images with an input-pixel limit. Animated-image measurements use the first frame. FFmpeg verifies audio/video streams rather than trusting an extension. It samples video near the opening, 40%, and 80% of the duration for optional visual review. These samples can miss important scenes.

## Local and AI modes

**Local mode** runs without an API key. Text-based rules and real media measurements drive the assessment, suggestions, and writing templates. A caption or transcript improves the available evidence, but a supplied description is still user-provided context. In this mode, a filename or file-size number never substitutes for semantic understanding of an image, recording, or video.

**AI mode** adds a model's interpretation of the submitted text and available image samples. OpenAI supports image inputs for visual analysis; Viralify prepares resized JPEGs from the decoded source for this purpose. See [OpenAI's image and vision guide](https://developers.openai.com/api/docs/guides/images-vision). For audio/video, the first three minutes of available audio can be converted to a mono 16 kHz WAV and transcribed. This short extraction stays below the transcription API's documented 25 MB file limit. See [OpenAI's file transcription guide](https://developers.openai.com/api/docs/guides/speech-to-text).

The AI response is requested in a defined JSON schema and validated before use. Structured output makes a response easier to validate and display; it does not verify the model's judgments or factual claims. See [OpenAI's Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs). If semantic review or transcription is unavailable, the app retains the local evidence and surfaces the limitation. AI editorial feedback does not replace the numeric rubric or publishing grid; an available transcript can contribute text evidence to the local assessment.

Confidence describes how much relevant evidence is available. It is qualitative and not a statistical confidence interval. Even AI-assisted review cannot infer the future recommendation-system distribution or how an unknown audience will respond.

## Interpreting the rubric

The assessment breaks readiness into dimensions displayed with their scores, weights, and explanations, so the user can inspect the reasons behind the result. The checks use signals such as the opening wording, clarity, specificity, engagement prompts, and format suitability. Fixed rules are deliberately inspectable, but they are incomplete: rhetorical questions, numbers, short sentences, and calls to action can exist in poor content too.

Use scores to compare revisions of the same draft under the same platform, objective, and audience settings. Scores across unrelated content types or audiences are not directly equivalent. Changing a caption or selecting a different goal may alter the assessment without changing the actual media. Feedback should therefore be reviewed against the original content before applying it.

Suggestions prioritize weaknesses detected by the rubric. Hook variants, optimized text, and hashtags are draft ideas. They need a human review for factual accuracy, voice, relevance, and whether any suggested claim is supportable. Suggested hashtags are not live popularity rankings.

## Publishing windows

The weekly publishing grid and recommended slots are **Viralify's own heuristic starting points**. They are generated from platform profiles and general time-of-day assumptions. Their strength values are relative ranks within that grid, not audience activity measurements, probabilities, or forecast reach. The selected timezone labels those local-hour assumptions; it does not reveal where the creator's audience lives.

No source cited here validates Viralify's specific hours or weights. The app does not currently import follower activity, regional holidays, competing posts, or current algorithm changes. Suggested hours should be replaced or adjusted using your own measured audience behavior.

For example, YouTube's Audience report provides times when a channel's viewers were online across YouTube during the previous 28 days, and describes uses for community planning, Premieres, and live streams. That is account-specific evidence the creator can consult; Viralify does not retrieve it. See [YouTube's audience documentation](https://support.google.com/youtube/answer/9314416?hl=en).

Saving a slot adds an item to Viralify's calendar. It does not publish content to a platform, reserve a platform slot, or schedule a notification. The creator still publishes through the chosen platform and updates the record manually.

## Learn from real outcomes

Record views, likes, comments, shares, and saves after publication. Use a consistent observation window, such as the same elapsed time after each post, to make comparisons more meaningful. Compare similar formats and objectives; reach, community conversation, and conversions are different outcomes.

The learning view calculates engagement as `(likes + comments + shares + saves) / views × 100` when views are greater than zero. These interactions can overlap, so the result is not a unique-person engagement rate and can exceed 100%. It is computed from manually entered values, not imported platform analytics.

For a timing experiment, keep the content format and audience as similar as practical, vary the publishing window, and repeat the comparison. For a content experiment, change a specific element such as the opening hook. A single better-performing post does not isolate the cause: topic, audience size, distribution, and external events may also have changed.

Manually entered outcomes are saved for the creator's review. They do not automatically retrain the scoring rubric or personalize the publishing heatmap. Predictive modeling would require a consented historical dataset, clear outcome definitions, account-aware baselines, time-based validation, calibration, and monitoring for drift before its numbers could be described as probabilities.
