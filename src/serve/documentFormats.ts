/** File types accepted by the served chat document upload. Keep this aligned
 * with the documents agent and the manager's local upload intake. */
export const DOCUMENT_EXTENSIONS = [
  '.txt', '.md', '.markdown', '.csv', '.json', '.xml', '.yaml', '.yml', '.html', '.htm', '.rtf',
  '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp',
  '.docx', '.pptx', '.xlsx', '.doc', '.ppt', '.xls', '.odt', '.ods', '.odp',
  '.pdf',
] as const;

export const DOCUMENT_FILE_ACCEPT = DOCUMENT_EXTENSIONS.join(',');
export const DOCUMENT_UPLOAD_ALLOWED_EXTENSIONS = DOCUMENT_EXTENSIONS.map((ext) => ext.slice(1));
