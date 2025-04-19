import React, { useState, useEffect, useRef } from 'react';
import { XMarkIcon, ArrowLeftIcon, ArrowRightIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { Attachment } from '../../types';

interface ImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentImage: Attachment | null;
  images?: Attachment[];
  onPrev?: () => void;
  onNext?: () => void;
}

const ImageModal: React.FC<ImageModalProps> = ({ 
  isOpen, 
  onClose, 
  currentImage, 
  images = [],
  onPrev,
  onNext
}) => {
  const [isZoomed, setIsZoomed] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const thumbnailsRef = useRef<HTMLDivElement>(null);
  
  // Update currentIndex when currentImage changes
  useEffect(() => {
    if (currentImage && images.length > 0) {
      const index = images.findIndex(img => 
        img.id === currentImage.id || img.url === currentImage.url
      );
      if (index !== -1) {
        setCurrentIndex(index);
      }
    }
  }, [currentImage, images]);
  
  // Scroll active thumbnail into view
  useEffect(() => {
    if (thumbnailsRef.current && images.length > 0) {
      const thumbnailElements = thumbnailsRef.current.querySelectorAll('.thumbnail-item');
      if (thumbnailElements[currentIndex]) {
        thumbnailElements[currentIndex].scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center'
        });
      }
    }
  }, [currentIndex, isOpen]);
  
  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          handlePrevImage();
          break;
        case 'ArrowRight':
          handleNextImage();
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, onPrev, onNext, currentIndex, images.length]);
  
  // Close modal if clicking outside the image
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };
  
  // Toggle zoom on image click
  const handleImageClick = () => {
    setIsZoomed(!isZoomed);
  };
  
  const handlePrevImage = () => {
    if (images.length <= 1) return;
    const newIndex = (currentIndex - 1 + images.length) % images.length;
    setCurrentIndex(newIndex);
    onPrev?.();
  };
  
  const handleNextImage = () => {
    if (images.length <= 1) return;
    const newIndex = (currentIndex + 1) % images.length;
    setCurrentIndex(newIndex);
    onNext?.();
  };
  
  const handleThumbnailClick = (index: number) => {
    setCurrentIndex(index);
    // If external handlers provided, call them as well
    if (index < currentIndex && onPrev) onPrev();
    if (index > currentIndex && onNext) onNext();
  };
  
  const scrollThumbnails = (direction: 'left' | 'right') => {
    if (thumbnailsRef.current) {
      const scrollAmount = direction === 'left' ? -200 : 200;
      thumbnailsRef.current.scrollBy({
        left: scrollAmount,
        behavior: 'smooth'
      });
    }
  };
  
  if (!isOpen || !currentImage) return null;
  
  const hasMultipleImages = images.length > 1;
  
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm transition-opacity duration-300"
      onClick={handleBackdropClick}
    >
      <div className="relative w-full h-full flex flex-col">
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 flex justify-between items-center p-4 z-10 bg-gradient-to-b from-black/50 to-transparent">
          <div className="text-white text-sm font-medium truncate max-w-[80%]">
            {currentImage.name || 'Image'}
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-full bg-black/30 hover:bg-black/50 text-white transition-colors"
            aria-label="Close modal"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        
        {/* Image container */}
        <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
          <img 
            src={currentImage.url} 
            alt={currentImage.name || 'Image'} 
            onClick={handleImageClick}
            className={`
              max-h-[80vh] max-w-[90vw] object-contain transition-transform duration-300 cursor-zoom-in
              ${isZoomed ? 'scale-150 cursor-zoom-out' : ''}
            `}
          />
        </div>
        
        {/* Navigation controls */}
        {hasMultipleImages && (
          <div className="absolute inset-y-0 left-0 right-0 flex justify-between items-center px-4 pointer-events-none">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                handlePrevImage();
              }}
              className="p-2 rounded-full bg-black/30 hover:bg-black/50 text-white transition-colors pointer-events-auto"
              aria-label="Previous image"
            >
              <ArrowLeftIcon className="h-5 w-5" />
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                handleNextImage();
              }}
              className="p-2 rounded-full bg-black/30 hover:bg-black/50 text-white transition-colors pointer-events-auto"
              aria-label="Next image"
            >
              <ArrowRightIcon className="h-5 w-5" />
            </button>
          </div>
        )}
        
        {/* Thumbnails carousel at bottom */}
        {hasMultipleImages && (
          <div className="absolute bottom-4 left-0 right-0 flex flex-col items-center">
            <div className="bg-black/60 backdrop-blur-sm rounded-lg p-3 relative max-w-[95%] shadow-lg">
              {images.length > 5 && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      scrollThumbnails('left');
                    }}
                    className="absolute left-0 top-1/2 -translate-y-1/2 -ml-4 p-2 rounded-full bg-black/70 text-white z-10 pointer-events-auto shadow-md hover:bg-black/90 transition-all"
                    aria-label="Scroll thumbnails left"
                  >
                    <ChevronLeftIcon className="h-5 w-5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      scrollThumbnails('right');
                    }}
                    className="absolute right-0 top-1/2 -translate-y-1/2 -mr-4 p-2 rounded-full bg-black/70 text-white z-10 pointer-events-auto shadow-md hover:bg-black/90 transition-all"
                    aria-label="Scroll thumbnails right"
                  >
                    <ChevronRightIcon className="h-5 w-5" />
                  </button>
                </>
              )}
              
              <div 
                ref={thumbnailsRef}
                className="flex space-x-3 overflow-x-auto scrollbar-thin scrollbar-thumb-white/30 max-w-full pb-1 px-1 pt-1"
                style={{ scrollbarWidth: 'thin' }}
              >
                {images.map((image, index) => (
                  <div 
                    key={image.id || index}
                    className={`thumbnail-item flex-shrink-0 h-20 w-20 rounded-md overflow-hidden transition-all duration-200 pointer-events-auto cursor-pointer
                      ${currentIndex === index 
                          ? 'ring-2 ring-white scale-105 shadow-md' 
                          : 'ring-1 ring-white/30 opacity-70 hover:opacity-100 hover:ring-white/70'}
                    `}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleThumbnailClick(index);
                    }}
                  >
                    <img 
                      src={image.thumbnailUrl || image.url} 
                      alt={`Thumbnail ${index + 1}`}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ))}
              </div>
              
              {/* Show current position indicator */}
              <div className="mt-2 text-white text-xs text-center">
                {currentIndex + 1} of {images.length}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImageModal; 