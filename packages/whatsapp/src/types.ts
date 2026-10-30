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
  components?: TemplateComponent[];
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
