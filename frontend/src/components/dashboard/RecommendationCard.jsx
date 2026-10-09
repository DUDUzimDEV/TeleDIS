import React from 'react';

export default function RecommendationCard({ recommendations }) {
  return (
    <div className="panel-box">
      <div className="panel-header">
        <h3>Recomendações</h3>
        <span className="tag warning">2 novas</span>
      </div>

      <div className="recommendation-list">
        {recommendations.map((item) => (
          <div key={item.title} className="recommendation-item">
            <h4>{item.title}</h4>
            <p>{item.reason}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
