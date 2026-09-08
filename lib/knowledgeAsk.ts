export type KnowledgeAskSource = {
  id: string;
  title: string;
  category: string;
  similarity: number;
};

export type KnowledgeAskSuccess = {
  ok: true;
  answer: string;
  sources: KnowledgeAskSource[];
};

export type KnowledgeAskError = {
  ok?: false;
  error: string;
};

export async function askKnowledge(params: {
  prompt: string;
  category?: string | null;
}): Promise<KnowledgeAskSuccess> {
  const res = await fetch("/api/knowledge/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      prompt: params.prompt,
      category: params.category?.trim() ? params.category : undefined,
    }),
  });
  const json = (await res.json().catch(() => null)) as KnowledgeAskSuccess | KnowledgeAskError | null;
  if (!res.ok || !json || !("answer" in json)) {
    throw new Error((json && "error" in json && json.error) || `Ask failed (${res.status})`);
  }
  return json;
}
