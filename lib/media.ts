// ============================================================
// Travel Story — 素材二进制（服务端存储）
//
// v2：素材本体存服务端 data/media/（POST /api/media 上传，
// GET /api/media/<id> 读取，支持 Range 拖动进度条），元数据
// （MediaMeta）跟随行程存 data/trips.json。
// 将来换对象存储（S3 等）时只需改这三个函数的实现。
// ============================================================

/** 素材直链（<img>/<video> 直接用，浏览器自己缓存） */
export function mediaUrl(id: string): string {
  return `/api/media/${encodeURIComponent(id)}`;
}

export async function putMediaBlob(id: string, file: File): Promise<void> {
  const res = await fetch(
    `/api/media?id=${encodeURIComponent(id)}&name=${encodeURIComponent(file.name)}`,
    {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `上传失败（${res.status}）`);
  }
}

export async function deleteMediaBlob(id: string): Promise<void> {
  try {
    await fetch(`/api/media/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (e) {
    console.warn("[travel-story] 删除服务端素材失败", e);
  }
}
