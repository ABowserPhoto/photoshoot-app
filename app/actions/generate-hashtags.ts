"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";

export type GenerateHashtagsResult =
  | { ok: true; hashtags: string }
  | { ok: false; error: string };

export async function generateHashtagsAction(caption: string): Promise<GenerateHashtagsResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey?.trim()) {
    return {
      ok: false,
      error: "Gemini API key is missing. Set GEMINI_API_KEY in your environment.",
    };
  }

  const trimmedCaption = caption.trim();
  if (!trimmedCaption) {
    return {
      ok: false,
      error: "Write a caption first, then generate hashtags.",
    };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const prompt =
    "You are an expert social media manager. Given this post caption: '" +
    trimmedCaption.replace(/\\/g, "\\\\").replace(/'/g, "\\'") +
    "', generate 10-15 highly relevant, trending hashtags. Return ONLY the hashtags separated by spaces, with no extra text, quotes, or markdown.";

  try {
    const modelName = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    if (!text) {
      return { ok: false, error: "No hashtags were returned. Try again." };
    }

    return { ok: true, hashtags: text };
  } catch (error) {
    console.error("Gemini API Error:", error);
    const message = error instanceof Error ? error.message : "Failed to call Gemini.";
    return { ok: false, error: message };
  }
}
