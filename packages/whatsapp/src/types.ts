export interface SendTextMessageParams {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  body: string;
  previewUrl?: boolean;
}

export interface SendTemplateMessageParams {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  templateName: string;
  languageCode: string;
  /** Built by buildSendComponents in @speediator/types. */
  components?: ReadonlyArray<object>;
}

export interface TemplateComponent {
  type: 'header' | 'body' | 'button';
  parameters: TemplateParameter[];
  sub_type?: string;
  index?: string;
}

export interface TemplateParameter {
  type: 'text' | 'currency' | 'date_time' | 'image' | 'document' | 'video';
  text?: string;
  image?: { link: string };
  document?: { link: string };
  video?: { link: string };
}

export interface WhatsAppApiResponse {
  messages: Array<{ id: string }>;
  contacts?: Array<{ input: string; wa_id: string }>;
}

export interface CreateTemplateParams {
  wabaId: string;
  accessToken: string;
  name: string;
  language: string;
  category: string;
  components: object[];
}

export interface MetaTemplateApiResponse {
  id: string;
  status: string;
}

export interface PhoneNumberDetails {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  /** True when the number is also in use on the WhatsApp Business app (coexistence). */
  is_on_biz_app?: boolean;
  platform_type?: string;
}

export type SmbAppDataSyncType = 'smb_app_state_sync' | 'history';

export interface UploadFileParams {
  accessToken: string;
  fileName: string;
  fileType: string;
  bytes: Uint8Array<ArrayBuffer>;
}
