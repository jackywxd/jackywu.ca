import type { JSX } from 'react';
import { DecoratorNode, type EditorConfig, type LexicalNode, type NodeKey, type SerializedLexicalNode, type Spread } from 'lexical';
import { BlockPreview } from '../BlockPreview';

export type BlockFields = { blockType: string } & Record<string, unknown>;
export type SerializedBlockNode = Spread<{ type: 'block'; version: 2; format: ''; fields: BlockFields }, SerializedLexicalNode>;

/**
 * 站內區塊（圖、圖組、影片、路線、待補圖、墨線、程式碼、RawMdx）。
 * 序列化成 Payload 的 { type: 'block', fields } 形狀，前台 lexicalToTree 直接吃。
 */
export class BlockNode extends DecoratorNode<JSX.Element> {
  __fields: BlockFields;

  static getType() { return 'block'; }
  static clone(n: BlockNode) { return new BlockNode(n.__fields, n.__key); }

  constructor(fields: BlockFields, key?: NodeKey) {
    super(key);
    this.__fields = fields;
  }

  static importJSON(j: SerializedBlockNode): BlockNode { return new BlockNode({ ...j.fields }); }
  exportJSON(): SerializedBlockNode { return { type: 'block', version: 2, format: '', fields: { ...this.__fields } }; }

  createDOM(_c: EditorConfig): HTMLElement {
    const d = document.createElement('div');
    d.className = 'ed-block';
    d.contentEditable = 'false';
    d.dataset.blockType = this.__fields.blockType;
    return d;
  }
  updateDOM() { return false; }
  isInline() { return false; }
  isIsolated() { return true; }
  getFields(): BlockFields { return this.getLatest().__fields; }
  setFields(fields: BlockFields): this {
    const w = this.getWritable();
    w.__fields = fields;
    return w;
  }
  decorate(): JSX.Element { return <BlockPreview nodeKey={this.__key} fields={this.__fields} />; }
}

export const $createBlockNode = (fields: BlockFields) => new BlockNode(fields);
export const $isBlockNode = (n: LexicalNode | null | undefined): n is BlockNode => n instanceof BlockNode;
