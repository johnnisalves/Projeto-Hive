/**
 * Estado dos recursos extras de publicacao do Instagram.
 *
 * Fica separado do componente de propósito: e logica pura, sem React, entao
 * pode ser testada direto no Node (ver ig-options.test.ts).
 */

export interface UserTag {
  username: string;
  x: number;
  y: number;
  imageIndex: number;
}

export interface IgOptions {
  userTags: UserTag[];
  collaborators: string[];
  locationId: string;
  altText: string;
  shareToFeed: boolean;
  audioName: string;
  coverUrl: string;
  audioUrl: string;
  audioFileName: string;
  audioVolume: number;
  isAiGenerated: boolean;
  isPaidPartnership: boolean;
  sponsorIds: string[];
  /** Hashtags no 1o comentario em vez da legenda. */
  hashtagsFirstComment: boolean;
}

export function defaultIgOptions(): IgOptions {
  return {
    userTags: [],
    collaborators: [],
    locationId: '',
    altText: '',
    shareToFeed: true,
    audioName: '',
    coverUrl: '',
    audioUrl: '',
    audioFileName: '',
    audioVolume: 80,
    isAiGenerated: false,
    isPaidPartnership: false,
    sponsorIds: [],
    hashtagsFirstComment: false,
  };
}

/**
 * Monta o pedaco do payload que vai para a API — omite o que esta vazio para
 * nao gravar campo em branco no banco nem mandar parametro inutil ao Meta.
 */
export function igOptionsToPayload(o: IgOptions): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (o.userTags.length) p.userTags = o.userTags;
  if (o.collaborators.length) p.collaborators = o.collaborators;
  if (o.locationId.trim()) p.locationId = o.locationId.trim();
  if (o.altText.trim()) p.altText = o.altText.trim();
  // shareToFeed so viaja quando e false: true ja e o padrao da coluna.
  if (!o.shareToFeed) p.shareToFeed = false;
  if (o.audioName.trim()) p.audioName = o.audioName.trim();
  if (o.coverUrl.trim()) p.coverUrl = o.coverUrl.trim();
  if (o.audioUrl) {
    p.audioUrl = o.audioUrl;
    p.audioVolume = o.audioVolume;
  }
  if (o.isAiGenerated) p.isAiGenerated = true;
  if (o.isPaidPartnership) p.isPaidPartnership = true;
  if (o.sponsorIds.length) p.sponsorIds = o.sponsorIds;
  if (o.hashtagsFirstComment) p.hashtagsFirstComment = true;
  return p;
}
