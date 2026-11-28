import {
  buildCreateComponents,
  buildSendComponents,
  describeTemplate,
  NewTemplateSchema,
  parseTemplateVariables,
  templateToFormValues,
  variableProblems,
} from '@speediator/types';

// As Meta returns a synced template.
const orderTemplate = [
  { type: 'HEADER', format: 'TEXT', text: 'Hi {{1}}' },
  { type: 'BODY', text: 'Order {{2}} for {{1}} ships {{3}}.' },
  { type: 'FOOTER', text: 'Reply STOP to opt out' },
  {
    type: 'BUTTONS',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Thanks' },
      { type: 'URL', text: 'Track', url: 'https://shop.example/track/{{1}}', example: ['ABC'] },
      { type: 'COPY_CODE', example: 'SAVE10' },
    ],
  },
];

const recipient = { name: 'Priya', phone: '919876543210', attributes: { order_id: 'A-77' } };

describe('template variables', () => {
  it('finds every placeholder a sender must fill, positional ones in number order', () => {
    const shape = describeTemplate(orderTemplate);
    expect(shape.slots.map((s) => s.key)).toEqual(['header.1', 'body.1', 'body.2', 'body.3', 'button.1', 'button.2']);
    expect(shape.named).toBe(false);
  });

  it('builds the send components with contact data, fallbacks and fixed values', () => {
    const vars = parseTemplateVariables({
      values: {
        'header.1': { source: 'contact', field: 'name', fallback: 'there' },
        'body.1': { source: 'contact', field: 'name', fallback: 'there' },
        'body.2': { source: 'attribute', key: 'order_id' },
        'body.3': { source: 'static', value: 'today' },
        'button.1': { source: 'attribute', key: 'order_id' },
        'button.2': { source: 'static', value: 'SAVE10' },
      },
    });
    const { components, missing } = buildSendComponents(orderTemplate, vars, recipient);
    expect(missing).toEqual([]);
    expect(components).toEqual([
      { type: 'header', parameters: [{ type: 'text', text: 'Priya' }] },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Priya' },
          { type: 'text', text: 'A-77' },
          { type: 'text', text: 'today' },
        ],
      },
      { type: 'button', sub_type: 'url', index: '1', parameters: [{ type: 'text', text: 'A-77' }] },
      { type: 'button', sub_type: 'copy_code', index: 2, parameters: [{ type: 'coupon_code', coupon_code: 'SAVE10' }] },
    ]);
  });

  it('uses the default value when the contact has no name, and reports values it cannot fill', () => {
    const vars = parseTemplateVariables({
      values: {
        'header.1': { source: 'contact', field: 'name', fallback: 'there' },
        'body.1': { source: 'contact', field: 'name' },
      },
    });
    const { components, missing } = buildSendComponents(orderTemplate, vars, { name: null, phone: '91' });
    expect(components[0]).toEqual({ type: 'header', parameters: [{ type: 'text', text: 'there' }] });
    expect(missing).toEqual(expect.arrayContaining(['Body {{1}}', 'Body {{2}}']));
  });

  it('sends named parameters with their names', () => {
    const named = [{ type: 'BODY', text: 'Hi {{first_name}}' }];
    const { components } = buildSendComponents(
      named,
      parseTemplateVariables({ values: { 'body.first_name': { source: 'static', value: 'Ravi' } } }),
      recipient,
    );
    expect(components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Ravi', parameter_name: 'first_name' }] },
    ]);
  });

  it('sends a media header by uploaded id, with the document file name', () => {
    const doc = [{ type: 'HEADER', format: 'DOCUMENT' }, { type: 'BODY', text: 'Your invoice' }];
    const vars = parseTemplateVariables({ values: {}, headerMedia: { id: '123', filename: 'invoice.pdf' } });
    expect(buildSendComponents(doc, vars, recipient).components).toEqual([
      { type: 'header', parameters: [{ type: 'document', document: { id: '123', filename: 'invoice.pdf' } }] },
    ]);
  });

  it('refuses a campaign whose variables or media header are not set', () => {
    const image = [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Hi {{1}}' }];
    expect(variableProblems(image, { values: { 'body.1': { source: 'static', value: '' } } })).toEqual([
      'Body {{1}} needs a value',
      'The image header needs a file or link',
    ]);
    expect(variableProblems([{ type: 'BODY', text: 'Hello' }], { values: {} })).toEqual([]);
  });

  it('treats old campaign variable maps as empty instead of failing', () => {
    expect(parseTemplateVariables({ '1': 'x' })).toEqual({ values: {} });
  });
});

describe('creating templates', () => {
  const base = {
    whatsappAccountId: '00000000-0000-4000-8000-000000000000',
    name: 'diwali_offer',
    language: 'en',
    category: 'MARKETING' as const,
  };

  it('builds Meta components with examples, and puts quick replies before other buttons', () => {
    const t = NewTemplateSchema.parse({
      ...base,
      header: { format: 'IMAGE', handle: '4::abc' },
      body: { text: 'Hi {{1}}, get {{2}} off', examples: ['Priya', '20%'] },
      footer: 'Reply STOP to opt out',
      buttons: [
        { type: 'URL', text: 'Shop', url: 'https://shop.example/?c={{1}}', example: 'DIWALI' },
        { type: 'QUICK_REPLY', text: 'Stop promotions' },
        { type: 'PHONE_NUMBER', text: 'Call us', phoneNumber: '+919876543210' },
      ],
    });
    expect(buildCreateComponents(t)).toEqual([
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4::abc'] } },
      { type: 'BODY', text: 'Hi {{1}}, get {{2}} off', example: { body_text: [['Priya', '20%']] } },
      { type: 'FOOTER', text: 'Reply STOP to opt out' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Stop promotions' },
          { type: 'URL', text: 'Shop', url: 'https://shop.example/?c={{1}}', example: ['DIWALI'] },
          { type: 'PHONE_NUMBER', text: 'Call us', phone_number: '919876543210' },
        ],
      },
    ]);
  });

  it('rejects missing examples, skipped numbers and too many buttons of a kind', () => {
    const bad = NewTemplateSchema.safeParse({
      ...base,
      category: 'UTILITY',
      body: { text: 'Hi {{1}} {{3}}', examples: ['a'] },
      buttons: [
        { type: 'PHONE_NUMBER', text: 'A', phoneNumber: '919876543210' },
        { type: 'PHONE_NUMBER', text: 'B', phoneNumber: '919876543211' },
        { type: 'COPY_CODE', example: 'X' },
      ],
    });
    expect(bad.success).toBe(false);
    const messages = bad.success ? [] : bad.error.issues.map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'Body variables must be numbered {{1}}, {{2}}, {{3}}… in order',
        'Give one example value for each body variable (2 needed)',
        'A template can have only 1 call button',
        'Copy-code buttons are only allowed in marketing templates',
      ]),
    );
  });

  it('turns a stored template back into form values for duplicating', () => {
    const values = templateToFormValues([
      { type: 'HEADER', format: 'TEXT', text: 'Hi {{1}}', example: { header_text: ['Priya'] } },
      { type: 'BODY', text: 'Code {{1}}', example: { body_text: [['X1']] } },
      { type: 'BUTTONS', buttons: [{ type: 'PHONE_NUMBER', text: 'Call', phone_number: '919876543210' }] },
    ]);
    expect(values).toEqual({
      header: { format: 'TEXT', text: 'Hi {{1}}', example: 'Priya' },
      body: 'Code {{1}}',
      bodyExamples: ['X1'],
      footer: '',
      buttons: [{ type: 'PHONE_NUMBER', text: 'Call', phoneNumber: '+919876543210' }],
    });
  });
});
