import React from 'react';

export default function PageHeading({ eyebrow, title, description, actions, className = '' }) {
  return (
    <header className={`page-heading ${className}`.trim()}>
      <div className="page-heading-copy">
        {eyebrow ? <p className="page-eyebrow">{eyebrow}</p> : null}
        <h1 className="page-heading-title">{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="page-heading-actions">{actions}</div> : null}
    </header>
  );
}
