import React from 'react';

export default function PageHeading({ eyebrow, title, description, actions, className = '' }) {
  return (
    <header className={`page-heading ${className}`}>
      <div>
        {eyebrow ? <p className="page-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="page-heading-actions">{actions}</div> : null}
    </header>
  );
}
