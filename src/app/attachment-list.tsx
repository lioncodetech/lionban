import Image from "next/image";

export type Attachment = { file:File; preview:string };

type AttachmentListProps = {
  attachments:Attachment[];
  onPreview:(attachment:Attachment)=>void;
  onRemove:(index:number)=>void;
};

export function AttachmentList({ attachments, onPreview, onRemove }:AttachmentListProps) {
  return <div className="attachment-list">{attachments.map((item,index) =>
    <div className="attachment" key={`${item.file.name}-${index}`}>
      <button className="attachment-preview" type="button" onClick={()=>onPreview(item)} aria-label={`Ampliar ${item.file.name}`}>
        <Image src={item.preview} alt="" width={42} height={42} unoptimized />
      </button>
      <span><strong>{item.file.name}</strong><small>{Math.ceil(item.file.size/1024)} KB</small></span>
      <button type="button" onClick={()=>onRemove(index)} aria-label={`Remover ${item.file.name}`}>×</button>
    </div>
  )}</div>;
}
