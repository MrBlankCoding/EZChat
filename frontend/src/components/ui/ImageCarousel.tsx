import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { Attachment } from '../../types';
import { ImageModal } from './';

interface ImageCarouselProps {
  images: Attachment[];
  className?: string;
}

const ImageCarousel: React.FC<ImageCarouselProps> = ({ images, className = '' }) => {
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  // Filter only image attachments
  const imageAttachments = images.filter(att => {
    const type = att.type || '';
    const fileType = att.fileType || '';
    return (
      type === 'image' || 
      type.startsWith('image/') || 
      fileType.startsWith('image/')
    );
  });
  
  // Don't render if no images
  if (imageAttachments.length === 0) return null;
  
  const handlePrev = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -200, behavior: 'smooth' });
    }
  };
  
  const handleNext = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 200, behavior: 'smooth' });
    }
  };
  
  const openImageModal = (index: number) => {
    setCurrentIndex(index);
    setModalOpen(true);
  };
  
  const handlePrevImage = () => {
    if (currentIndex === null) return;
    setCurrentIndex((currentIndex - 1 + imageAttachments.length) % imageAttachments.length);
  };
  
  const handleNextImage = () => {
    if (currentIndex === null) return;
    setCurrentIndex((currentIndex + 1) % imageAttachments.length);
  };
  
  return (
    <>
      <div className={`relative ${className}`}>
        <div className="flex items-center">
          {/* Left scroll button */}
          {imageAttachments.length > 3 && (
            <button
              onClick={handlePrev}
              className="absolute left-0 z-10 p-1 rounded-full bg-white/80 dark:bg-dark-800/80 shadow-md hover:bg-white dark:hover:bg-dark-700 transition-colors"
              aria-label="Scroll left"
            >
              <ChevronLeftIcon className="h-4 w-4 text-gray-600 dark:text-gray-300" />
            </button>
          )}
          
          {/* Scrollable image container */}
          <div 
            ref={scrollContainerRef}
            className="flex space-x-2 overflow-x-auto py-2 px-1 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-dark-600 max-w-full"
          >
            {imageAttachments.map((image, index) => (
              <div 
                key={image.id || index}
                className="flex-shrink-0 rounded-lg overflow-hidden border border-gray-200 dark:border-dark-600 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => openImageModal(index)}
              >
                <img 
                  src={image.thumbnailUrl || image.url} 
                  alt={image.name || `Image ${index + 1}`}
                  className="h-16 w-16 object-cover"
                  loading="lazy"
                />
              </div>
            ))}
          </div>
          
          {/* Right scroll button */}
          {imageAttachments.length > 3 && (
            <button
              onClick={handleNext}
              className="absolute right-0 z-10 p-1 rounded-full bg-white/80 dark:bg-dark-800/80 shadow-md hover:bg-white dark:hover:bg-dark-700 transition-colors"
              aria-label="Scroll right"
            >
              <ChevronRightIcon className="h-4 w-4 text-gray-600 dark:text-gray-300" />
            </button>
          )}
        </div>
      </div>
      
      {/* Image Modal */}
      <ImageModal 
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        currentImage={currentIndex !== null ? imageAttachments[currentIndex] : null}
        images={imageAttachments}
        onPrev={handlePrevImage}
        onNext={handleNextImage}
      />
    </>
  );
};

export default ImageCarousel; 