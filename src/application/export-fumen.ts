import type { FumenCodec, FumenData, FumenPageInput, FumenUrls } from "../domain/fumen";

export interface ExportFumenRequest {
  readonly pages: readonly FumenPageInput[];
}

export interface ExportFumenResponse {
  readonly data: FumenData;
  readonly urls: FumenUrls;
}

export class ExportFumenUseCase {
  constructor(private readonly codec: FumenCodec) {}

  execute(request: ExportFumenRequest): ExportFumenResponse {
    if (request.pages.length === 0) {
      throw new Error("At least one fumen page is required.");
    }

    const data = this.codec.encodePages(request.pages);
    return {
      data,
      urls: this.codec.createUrls(data)
    };
  }
}
