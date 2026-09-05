export interface ImportedDictionary {
  id: string;
  kind: 'stardict' | 'mdict' | 'dict' | 'slob';
  name: string;
  bundleDir: string;
  files: {
    ifo?: string;
    idx?: string;
    dict?: string;
    syn?: string;
    mdx?: string;
    mdd?: string[];
    /** DICT：.index + .dict/.dict.dz */
    dictBundle?: { index: string; dict: string };
    slob?: string;
  };
  addedAt: number;
  deletedAt?: number;
  unavailable?: boolean;
  /** 启用开关：false 时该词典不参与任何查询；缺省视为启用（旧数据向后兼容）。 */
  enabled?: boolean;
  unsupported?: boolean;
  unsupportedReason?: string;
}
